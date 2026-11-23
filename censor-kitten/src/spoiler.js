const kittenSpoilers = (() => {
  const glyphs = ["*", "~", "✦", "·", "?", "🐾", "😺", "✿", "♡", "#"];
  let anchorId = 0;
  function pattern() {
    return Array.from({ length: 16 }, () => {
      const mark = glyphs[Math.floor(Math.random() * glyphs.length)];
      return " ".repeat(1 + Math.floor(Math.random() * 5)) + mark;
    }).join("");
  }

  function mount(block, reveal) {
    const original = document.createElement("span");
    original.dataset.ckHidden = "";
    original.inert = true;
    original.setAttribute("aria-hidden", "true");
    original.append(...block.childNodes);
    const link = block.closest("a[href]");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.ckCover = pattern();
    button.setAttribute("aria-label", "Reveal original text");
    button.title = "Reveal original text";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reveal();
    });
    block.dataset.ckSpoiler = "";
    block.append(original);
    if (link) {
      const anchor = `--ck-headline-${++anchorId}`;
      const previous = block.style.getPropertyValue("anchor-name");
      const priority = block.style.getPropertyPriority("anchor-name");
      block.style.setProperty("anchor-name", anchor, "important");
      button.dataset.ckLinked = "";
      button.style.setProperty("position-anchor", anchor, "important");
      link.after(button);
      return { original, button, link, previous, priority };
    }
    if (getComputedStyle(block).position === "static") block.dataset.ckPosition = "";
    block.append(button);
    return { original, button };
  }

  function unmount(block, { original, button, link, previous, priority }) {
    const focused = document.activeElement === button;
    button.remove();
    if (original.parentNode === block) original.replaceWith(...original.childNodes);
    if (link) {
      if (previous) block.style.setProperty("anchor-name", previous, priority);
      else block.style.removeProperty("anchor-name");
    }
    delete block.dataset.ckSpoiler;
    delete block.dataset.ckPosition;
    if (focused && block.isConnected) {
      const temporary = !block.hasAttribute("tabindex");
      if (temporary) block.tabIndex = -1;
      block.focus({ preventScroll: true });
      if (temporary) block.removeAttribute("tabindex");
    }
  }

  function showKitten(onPanelMessage) {
    const host = document.createElement("div");
    host.dataset.ckKitten = "";
    const root = host.attachShadow({ mode: "closed" });
    const styles = new CSSStyleSheet();
    styles.replaceSync(`
      button { position: absolute; top: 8px; left: 8px; width: 66px; height: 56px;
        display: block; padding: 3px; border: 0; background: transparent; cursor: pointer; pointer-events: auto;
        filter: drop-shadow(0 2px 3px #0007); }
      button:focus-visible { outline: 2px solid #e2d888; outline-offset: -2px; border-radius: 8px; }
      svg { width: 100%; height: 100%; }
      .pupils { transform: translateY(1.25px); }
      :host([data-ck-kitten="resting"]) .open-eyes { display: none; }
      :host([data-ck-kitten="resting"]) .closed-eyes { display: inline; }
      @media (prefers-reduced-motion: no-preference) {
        :host([data-ck-kitten="scanning"]) .pupils { animation: glance 880ms step-end infinite; }
        @keyframes glance {
          from { transform: translate(-2.5px, 1.25px); }
          50%, to { transform: translate(2.5px, 1.25px); }
        }
      }
      iframe { position: absolute; top: 70px; left: 8px; width: min(24rem, calc(100vw - 16px));
        height: min(44rem, calc(100vh - 78px)); border: 1px solid #a48565; border-radius: 10px;
        background: #f9f4ea; box-shadow: 0 3px 14px #0006; pointer-events: auto; }
    `);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Toggle Censor Kitten panel");
    button.setAttribute("aria-expanded", "false");
    const svg = new DOMParser().parseFromString(CENSOR_KITTEN_SVG, "image/svg+xml").documentElement;
    svg.setAttribute("aria-hidden", "true");
    button.append(document.importNode(svg, true));
    root.adoptedStyleSheets = [styles];
    root.append(button);
    const url = chrome.runtime.getURL("sidebar.html");
    const origin = url.slice(0, url.lastIndexOf("/"));
    let frame;
    button.addEventListener("click", () => {
      if (frame) {
        frame.remove();
        frame = undefined;
      } else {
        frame = document.createElement("iframe");
        frame.title = "Censor Kitten panel";
        frame.src = url;
        root.append(frame);
      }
      button.setAttribute("aria-expanded", String(Boolean(frame)));
    });
    window.addEventListener("message", async ({ source, origin: sender, data }) => {
      if (!frame || source !== frame.contentWindow || sender !== origin || data?.type !== "censor-kitten-panel") return;
      const snapshot = await onPanelMessage(data.command);
      if (snapshot && frame?.contentWindow === source) {
        source.postMessage({ type: "censor-kitten-snapshot", ...snapshot }, origin);
      }
    });
    return (state) => {
      if (!host.isConnected) document.documentElement.append(host);
      if (host.dataset.ckKitten !== state) host.dataset.ckKitten = state;
    };
  }
  return { mount, unmount, showKitten };
})();
