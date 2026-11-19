(() => {
  const BLOCK = "h1,h2,h3,p,blockquote,li,div";
  const MAIN = "main,[role=main]";
  const EXCLUDE = "aside,nav,footer,form,pre,code,button,label,textarea,select,[contenteditable]:not([contenteditable=false]),[role=button],[role=navigation],[hidden],[aria-hidden=true]";
  const MEDIA = "img,picture,video,audio,canvas,svg,iframe,object,embed";
  const MAX_TEXT = 320;
  const MAX_ACTIVITY = 12;
  const MAX_WALKS = 24;
  const watched = new Set();
  const nearby = new Set();
  const seen = new WeakMap();
  const spoilers = new Map();
  const walks = new Map();
  let active = true;
  let failed = false;
  let pending = false;
  let runs = 0;
  let epoch = 0;
  let timer;
  let scan;
  let kitten;
  let requestId;
  let scanning = false;
  let scope;
  let current;
  let waiting = false;
  let lastError;
  let activity = [];

  function updateKitten() {
    kitten ??= kittenSpoilers.showKitten();
    kitten(scanning && active && !document.hidden ? "scanning" : spoilers.size ? "alert" : "resting");
  }

  const badge = () => {
    updateKitten();
    browser.runtime.sendMessage({ type: "badge", paused: !active, failed, count: spoilers.size }).catch(() => {});
  };
  function updateScope() {
    if (!scope?.isConnected || scope === document.body) scope = document.querySelector(MAIN) ?? document.body;
  }
  const blockText = (el) => el.textContent.replace(/\s+/g, " ").trim();
  const getText = (el) => {
    if (!el.isConnected || !scope?.contains(el) || el.closest(EXCLUDE) || el.closest("a")) return;
    if (el.querySelector(`${BLOCK},${EXCLUDE},${MEDIA}`)) return;
    if (el.querySelector("a")) {
      const nodes = document.createNodeIterator(el, NodeFilter.SHOW_TEXT);
      let prose = false;
      for (let node; (node = nodes.nextNode());) {
        if (node.data.trim() && !node.parentElement.closest("a")) { prose = true; break; }
      }
      if (!prose) return;
    }
    const text = blockText(el);
    if (text.length >= 4) return text.slice(0, MAX_TEXT);
  };

  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!watched.has(target)) continue;
      if (!target.isConnected) {
        forget(target);
        continue;
      }
      if (isIntersecting) nearby.add(target);
      else nearby.delete(target);
    }
    schedule();
  }, { rootMargin: "160px 0px" });

  function forget(el) {
    observer.unobserve(el);
    watched.delete(el);
    nearby.delete(el);
  }

  function consider(el) {
    if (!el.matches(BLOCK) || spoilers.has(el) || watched.has(el)) return;
    const text = getText(el);
    if (!text || seen.get(el) === text) return;
    watched.add(el);
    observer.observe(el);
  }

  function walk(el) {
    if (!(el instanceof Element) || walks.has(el)) return;
    if (walks.size === MAX_WALKS) {
      // Under a mutation storm prefer the most recent inserted content.
      walks.delete(walks.keys().next().value);
    }
    walks.set(el, document.createNodeIterator(el, NodeFilter.SHOW_ELEMENT));
    if (!scan) scan = requestIdleCallback(scanSlice, { timeout: 200 });
  }

  function scanSlice(deadline) {
    scan = undefined;
    const start = performance.now();
    updateScope();
    for (let n = 0; n < 60 && walks.size && performance.now() - start < 4; n++) {
      const [el, iterator] = walks.entries().next().value;
      const candidate = el.isConnected && iterator.nextNode();
      if (candidate) consider(candidate);
      else walks.delete(el);
      if (n >= 7 && deadline.timeRemaining() === 0) break;
    }
    if (walks.size) scan = requestIdleCallback(scanSlice, { timeout: 200 });
  }

  function conceal(el) {
    const text = blockText(el);
    const cover = kittenSpoilers.mount(el, () => {
      reveal(el);
      badge();
    });
    spoilers.set(el, { ...cover, text });
    badge();
  }

  function reveal(el) {
    const spoiler = spoilers.get(el);
    spoilers.delete(el);
    kittenSpoilers.unmount(el, spoiler);
  }

  function schedule(delay = 50) {
    if (!active || failed || pending || timer || !nearby.size || document.hidden) return;
    timer = setTimeout(() => {
      timer = undefined;
      void decide();
    }, delay);
  }

  async function decide() {
    if (!active || failed || document.hidden) return;
    updateScope();
    for (const el of nearby) {
      const text = getText(el);
      if (!text || seen.get(el) === text) {
        forget(el);
        continue;
      }
      const version = epoch;
      current = { text };
      waiting = false;
      pending = true;
      requestId = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");
      const start = performance.now();
      let retry;
      try {
        const result = await browser.runtime.sendMessage({ type: "classify", text, requestId });
        if (version !== epoch) return;
        if (result?.retry) {
          retry = result.retry;
          waiting = true;
          return;
        }
        if (!result || result.error) throw new Error(result?.error ?? "No local decision received");
        runs++;
        forget(el);
        seen.set(el, text);
        performance.measure("Censor Kitten: local decision", { start, detail: {
          probability: result.probability, inferenceMs: result.inferenceMs, loadMs: result.loadMs,
        } });
        const unchanged = getText(el) === text;
        const hidden = unchanged && result.replace;
        if (hidden) conceal(el);
        if (!unchanged) consider(el);
        activity.unshift({ text, outcome: hidden ? "hidden" : unchanged ? "kept" : "changed",
          probability: result.probability, cutoff: result.cutoff, inputTokens: result.inputTokens,
          inferenceMs: result.inferenceMs });
        if (activity.length > MAX_ACTIVITY) activity.pop();
      } catch (error) {
        if (version !== epoch) return;
        console.warn("Censor Kitten stopped checking this page:", error);
        failed = true;
        lastError = error.message;
        stopWatching();
        badge();
      } finally {
        pending = false;
        requestId = undefined;
        scanning = false;
        updateKitten();
        if (!retry) current = undefined;
        schedule(retry);
      }
      return;
    }
  }

  const mutations = new MutationObserver((records) => {
    updateScope();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const owner = target?.closest("[data-ck-spoiler]");
      if (owner && spoilers.has(owner)) {
        const { original, button, text } = spoilers.get(owner);
        if (original.parentNode === owner && button.parentNode === owner && owner.childNodes.length === 2 &&
            !original.querySelector(`${BLOCK},${EXCLUDE},${MEDIA}`) && blockText(original) === text) continue;
        reveal(owner);
        seen.delete(owner);
        badge();
      }
      const block = target?.closest(BLOCK);
      if (block) consider(block);
      for (const node of record.addedNodes) walk(node);
      if (record.removedNodes.length) {
        for (const el of spoilers.keys()) {
          if (el.isConnected) continue;
          reveal(el);
          badge();
        }
      }
    }
  });

  function startWatching() {
    updateScope();
    if (!scope) return;
    mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
    walk(scope);
  }

  function stopWatching() {
    mutations.disconnect();
    observer.disconnect();
    watched.clear();
    nearby.clear();
    walks.clear();
    if (scan) cancelIdleCallback(scan);
    scan = undefined;
    clearTimeout(timer);
    timer = undefined;
  }

  document.addEventListener("visibilitychange", () => schedule());
  document.addEventListener("visibilitychange", updateKitten);
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "inference-started" && pending && active && requestId === msg.requestId) {
      scanning = true;
      updateKitten();
      return;
    }
    if (msg?.type === "page-status") {
      const phase = !active ? "paused" : failed ? "error"
        : document.hidden ? "hidden" : pending ? "checking" : waiting && nearby.size ? "waiting"
        : nearby.size ? "queued" : "watching";
      return Promise.resolve({ phase, runs, count: spoilers.size, activity, current, lastError });
    }
    if (msg?.type !== "toggle") return;
    epoch++;
    active = !active;
    current = undefined;
    requestId = undefined;
    scanning = false;
    waiting = false;
    if (active) {
      failed = false;
      lastError = undefined;
      activity = [];
      runs = 0;
      startWatching();
    } else {
      stopWatching();
      for (const el of spoilers.keys()) {
        reveal(el);
        seen.delete(el);
      }
    }
    badge();
    return Promise.resolve(true);
  });
  startWatching();
  updateKitten();
})();
