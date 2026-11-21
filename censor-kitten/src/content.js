(() => {
  const BLOCK = "h1,h2,h3,p,blockquote,li,div";
  const LINKED_HEADLINE = "a[href] :is(h1,h2,h3)";
  const linkedHeadline = (el) => el.matches(LINKED_HEADLINE);
  const MAIN = "main,[role=main]";
  const EXCLUDE = "aside,nav,footer,form,pre,code,button,label,time,textarea,select,[contenteditable]:not([contenteditable=false]),[role=button],[role=navigation],[role=doc-endnotes],[typeof~='mw:Extension/references'],[hidden],[aria-hidden=true]";
  const NON_PROSE = "img,picture,video,audio,canvas,svg,iframe,object,embed,style,script,template,noscript";
  const MAX_TEXT = 1000;
  const MAX_ACTIVITY = 12;
  const MAX_WALKS = 24;
  const PAUSE_KEY = "paused";
  const watched = new Set();
  const nearby = new Set();
  const seen = new WeakMap();
  const spoilers = new Map();
  const walks = new Map();
  let active;
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
    kitten ??= kittenSpoilers.showKitten(panelMessage);
    kitten(scanning && active && !document.hidden ? "scanning" : spoilers.size ? "alert" : "resting");
  }

  const badge = () => {
    updateKitten();
    browser.runtime.sendMessage({ type: "badge", paused: active === false, failed, count: spoilers.size }).catch(() => {});
  };
  function updateScope() {
    if (!scope?.isConnected || scope === document.body) scope = document.querySelector(MAIN) ?? document.body;
  }
  const blockText = (el) => el.textContent.replace(/\s+/g, " ").trim();
  const getText = (el) => {
    if (!el.isConnected || !scope?.contains(el) || el.closest(EXCLUDE) ||
        (el.closest("a") && !linkedHeadline(el))) return;
    if (el.querySelector(`${BLOCK},${EXCLUDE},${NON_PROSE}`)) return;
    if (el.querySelector("a")) {
      const nodes = document.createNodeIterator(el, NodeFilter.SHOW_TEXT);
      let prose = false;
      for (let node; (node = nodes.nextNode());) {
        if (node.data.trim() && !node.parentElement.closest("a")) { prose = true; break; }
      }
      if (!prose) return;
    }
    const text = blockText(el);
    if (text.length >= 4 && !/^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(text)) return text.slice(0, MAX_TEXT);
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
      for (const queued of walks.keys()) {
        if (queued !== scope) { walks.delete(queued); break; }
      }
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
    // Check story copy before navigation, infoboxes, and other page furniture.
    const priority = (el) => linkedHeadline(el) ? 0 : el.matches("p,blockquote") ? 1 : 2;
    const candidates = [...nearby];
    candidates.sort((a, b) => priority(a) - priority(b));
    for (const el of candidates) {
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
        const updatedText = getText(el);
        if (updatedText === text) seen.set(el, text);
        performance.measure("Censor Kitten: local decision", { start, detail: {
          probability: result.probability, inferenceMs: result.inferenceMs, loadMs: result.loadMs,
        } });
        const unchanged = updatedText === text;
        if (unchanged && result.replace) conceal(el);
        if (!unchanged) consider(el);
        activity.unshift(unchanged
          ? { text, outcome: result.replace ? "hidden" : "kept", probability: result.probability,
              cutoff: result.cutoff, instructions: result.instructions, inputTokens: result.inputTokens, inferenceMs: result.inferenceMs }
          : { text, outcome: "changed" });
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
        schedule(retry ?? 0);
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
        const { original, button, link, text } = spoilers.get(owner);
        if (original.parentNode === owner &&
            (link ? button.parentNode === link.parentNode && owner.closest("a[href]") === link && owner.childNodes.length === 1
              : button.parentNode === owner && owner.childNodes.length === 2) &&
            !original.querySelector(`${BLOCK},${EXCLUDE},${NON_PROSE}`) && blockText(original) === text) continue;
        reveal(owner);
        seen.delete(owner);
        badge();
      }
      const block = target?.closest(BLOCK);
      if (block) consider(block);
      for (const node of record.addedNodes) walk(node);
      if (record.removedNodes.length) {
        for (const [el, { button }] of spoilers) {
          if (el.isConnected && button.isConnected) continue;
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
    // Seed story copy before the incremental walk, even on busy pages.
    for (const el of scope.querySelectorAll(`${LINKED_HEADLINE},p,blockquote`)) consider(el);
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
  browser.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "inference-started" && pending && active && requestId === msg.requestId) {
      scanning = true;
      updateKitten();
      return;
    }
    if (msg?.type === "page-status") reply(pageSnapshot());
  });

  function pageSnapshot() {
    const phase = active === false ? "paused" : failed ? "error" : active === undefined ? "starting"
      : document.hidden ? "hidden" : pending ? "checking" : waiting && nearby.size ? "waiting"
      : nearby.size ? "queued" : "watching";
    return { phase, runs, count: spoilers.size, activity, current, lastError };
  }

  async function panelMessage(command) {
    if (command === "settings") {
      await browser.runtime.sendMessage({ type: "panel-settings" }).catch(console.error);
      return;
    }
    if (command !== "status") return;
    const worker = await browser.runtime.sendMessage({ type: "worker-status" }).catch(() => undefined);
    return { page: pageSnapshot(), worker };
  }

  function setActive(next) {
    if (active === next) return;
    epoch++;
    active = next;
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
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PAUSE_KEY]) setActive(changes[PAUSE_KEY].newValue !== true);
  });
  browser.storage.local.get(PAUSE_KEY).then((stored) => {
    if (active === undefined) setActive(stored[PAUSE_KEY] !== true);
  }).catch((error) => {
    failed = true;
    lastError = error.message;
    badge();
  });
})();
