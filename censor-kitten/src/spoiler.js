const kittenSpoilers = (() => {
  const glyphs = ["*", "~", "✦", "·", "?", "🐾", "😺", "✿", "♡", "#"];
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
    if (getComputedStyle(block).position === "static") block.dataset.ckPosition = "";
    block.dataset.ckSpoiler = "";
    block.append(original, button);
    return { original, button };
  }

  function unmount(block, { original, button }) {
    const focused = document.activeElement === button;
    button.remove();
    if (original.parentNode === block) original.replaceWith(...original.childNodes);
    delete block.dataset.ckSpoiler;
    delete block.dataset.ckPosition;
    if (focused && block.isConnected) {
      const temporary = !block.hasAttribute("tabindex");
      if (temporary) block.tabIndex = -1;
      block.focus({ preventScroll: true });
      if (temporary) block.removeAttribute("tabindex");
    }
  }

  function showKitten() {
    const host = document.createElement("span");
    host.dataset.ckKitten = "";
    host.setAttribute("aria-hidden", "true");
    const svg = new DOMParser().parseFromString(CENSOR_KITTEN_SVG, "image/svg+xml").documentElement;
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const shadow = host.attachShadow({ mode: "closed" });
    const art = shadow.appendChild(document.importNode(svg, true));
    const open = art.querySelector(".open-eyes");
    const closed = art.querySelector(".closed-eyes");
    const pupils = art.querySelector(".pupils");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let animation;
    document.documentElement.append(host);
    return (state) => {
      if (!host.isConnected) document.documentElement.append(host);
      if (host.dataset.ckKitten === state) return;
      host.dataset.ckKitten = state;
      open.setAttribute("display", state === "resting" ? "none" : "inline");
      closed.setAttribute("display", state === "resting" ? "inline" : "none");
      animation?.cancel();
      animation = state === "scanning" && !reducedMotion.matches ? pupils.animate(
        ["translateX(0)", "translateX(-4px)", "translateX(4px)", "translateX(0)"].map(transform => ({ transform })),
        { duration: 320, iterations: Infinity, easing: "ease-in-out" },
      ) : undefined;
    };
  }
  return { mount, unmount, showKitten };
})();
