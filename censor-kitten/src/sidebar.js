import { PAUSE_KEY } from "./settings.js";

const get = (id) => document.getElementById(id);
const toggle = get("toggle");
const feed = get("activity");
let toggling = false;
let paused;
let activityKey;

const labels = { hidden: "Covered", kept: "Kept", changed: "Not applied" };
const workerLabels = { cold: "Model unloaded until the next check", loading: "Loading model", running: "Running inference", ready: "Model ready", recovering: "Model will reload on next check" };
const loadLabels = {
  files: "reading bundled files", compatibility: "checking compatibility", inspect: "inspecting the bundle",
  "gpu-init": "starting WebGPU",
  "runtime-init": "starting WASM", verify: "verifying weights", weights: "loading weights",
};
const pageLabels = {
  starting: "Reading browser settings", paused: "Paused in this browser", error: "Checking stopped", hidden: "Waiting for the page to become visible",
  checking: "Checking a block", waiting: "Waiting for the worker", queued: "Block ready to check", watching: "Watching nearby text",
};
const duration = (ms) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const score = (value) => value > 0 && value < 0.0005 ? "<0.05%" : percent(value);

function renderToggle() {
  toggle.disabled = paused === undefined || toggling;
  toggle.textContent = paused ? "Resume" : "Pause";
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[PAUSE_KEY]) return;
  paused = changes[PAUSE_KEY].newValue === true;
  renderToggle();
});
chrome.storage.local.get(PAUSE_KEY).then((stored) => {
  paused ??= stored[PAUSE_KEY] === true;
  renderToggle();
}).catch(console.error);
toggle.addEventListener("click", async () => {
  if (paused === undefined || toggling) return;
  toggling = true;
  renderToggle();
  try { await chrome.storage.local.set({ [PAUSE_KEY]: !paused }); }
  catch (error) { console.error(error); }
  finally { toggling = false; renderToggle(); }
});

function text(id, value) {
  const node = get(id);
  if (node.textContent !== value) node.textContent = value;
}
function optional(id, value) {
  get(id).hidden = !value;
  text(id, value ?? "");
}
function render(page, worker, elsewhere) {
  text("runtime", `OpenDecider Nano · ${worker?.backend === "webgpu" ? "WebGPU" : "WebGPU required"}`);
  if (!worker) text("worker-status", "Worker status unavailable");
  else {
    const extra = worker.workerPhase === "loading" ? loadLabels[worker.loadStage]
      : worker.workerPhase === "running" && elsewhere ? "another tab"
      : worker.workerPhase === "ready" && worker.loadMs != null ? `loaded in ${duration(worker.loadMs)}` : "";
    text("worker-status", workerLabels[worker.workerPhase] + (extra ? ` · ${extra}` : ""));
  }
  text("page-status", page ? pageLabels[page.phase] : "No page activity. Open or reload a website to start.");
  optional("candidate", page?.current?.text);
  optional("error", page?.lastError);
  text("counts", page ? `${page.runs} checked · ${page.count} covered` : "");
  get("empty").hidden = Boolean(page?.activity.length);
  const key = JSON.stringify(page?.activity ?? []);
  if (key === activityKey) return;
  activityKey = key;
  const nodes = (page?.activity ?? []).map((event) => {
    const item = document.createElement("li");
    item.dataset.outcome = event.outcome;
    const title = document.createElement("strong");
    title.textContent = labels[event.outcome];
    const excerpt = document.createElement("p");
    excerpt.className = "original";
    const end = 112;
    excerpt.textContent = event.text.length > end ? `${event.text.slice(0, end).trimEnd()}…` : event.text;
    const metrics = document.createElement("p");
    metrics.className = "metrics";
    metrics.textContent = event.outcome === "changed"
      ? "The page updated while this text was being checked. The old result was discarded."
      : `${score(event.probability)} score · ${percent(event.cutoff)} cutoff · ${event.inputTokens} tokens · ${duration(event.inferenceMs)}`;
    item.append(excerpt, title, metrics);
    if (event.instructions) {
      const question = document.createElement("p");
      question.textContent = `Asked: ${event.instructions}`;
      item.append(question);
    }
    if (event.text.length > end) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Show full excerpt";
      const full = document.createElement("p");
      full.textContent = event.text;
      details.append(summary, full);
      item.append(details);
    }
    return item;
  });
  feed.replaceChildren(...nodes);
}

function embedded() {
  // Commands carry no page text. Snapshots return directly to this extension frame.
  const send = (command) => parent.postMessage({ type: "censor-kitten-panel", command }, "*");
  window.addEventListener("message", ({ source, data }) => {
    if (source === parent && data?.type === "censor-kitten-snapshot" && Array.isArray(data.page?.activity)) {
      render(data.page, data.worker, data.worker?.elsewhere);
    }
  });
  get("settings").addEventListener("click", () => send("settings"));
  setInterval(() => send("status"), 400);
  send("status");
}

async function native() {
  const { id: windowId } = await chrome.windows.getCurrent();
  let tabId;
  let generation = 0;
  let updating = false;

  async function refresh() {
    if (updating) return;
    updating = true;
    const version = generation;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (version !== generation) return;
      tabId = tab?.id;
      const [page, worker] = await Promise.all([
        tabId == null ? undefined : chrome.tabs.sendMessage(tabId, { type: "page-status" }, { frameId: 0 }).catch(() => undefined),
        chrome.runtime.sendMessage({ type: "worker-status" }).catch(() => undefined),
      ]);
      if (version === generation) render(page, worker, worker?.workingTab !== tabId);
    } finally { updating = false; }
  }
  function reset() {
    generation++;
    tabId = undefined;
    render();
  }
  chrome.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) reset(); });
  chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && change.status === "loading") reset(); });
  get("settings").addEventListener("click", () => chrome.runtime.openOptionsPage().catch(console.error));
  setInterval(refresh, 250);
  void refresh();
}

if (window === top) void native();
else embedded();
