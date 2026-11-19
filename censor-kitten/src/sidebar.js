const get = (id) => document.getElementById(id);
const toggle = get("toggle");
const feed = get("activity");
const { id: windowId } = await browser.windows.getCurrent();
let tabId;
let generation = 0;
let updating = false;
let toggling = false;
let activityKey;

const labels = { hidden: "Covered", kept: "Kept", changed: "Block changed before the decision" };
const workerLabels = { cold: "Model unloaded until the next check", loading: "Loading model", running: "Running inference", ready: "Model ready", recovering: "Model will reload on next check" };
const loadLabels = {
  files: "reading bundled files", compatibility: "checking compatibility", inspect: "inspecting the bundle",
  "runtime-init": "starting WASM", verify: "verifying weights", weights: "loading weights",
};
const pageLabels = {
  paused: "Paused on this page", error: "Checking stopped", hidden: "Waiting for the page to become visible",
  checking: "Checking a block", waiting: "Waiting for the worker", queued: "Block ready to check", watching: "Watching nearby text",
};
const duration = (ms) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
const percent = (value) => `${(value * 100).toFixed(1)}%`;

function text(id, value) {
  const node = get(id);
  if (node.textContent !== value) node.textContent = value;
}
function optional(id, value) {
  get(id).hidden = !value;
  text(id, value ?? "");
}
function render(page, worker) {
  if (!worker) text("worker-status", "Worker status unavailable");
  else {
    const extra = worker.workerPhase === "loading" ? loadLabels[worker.loadStage]
      : worker.workerPhase === "running" && worker.workingTab !== tabId ? "another tab"
      : worker.workerPhase === "ready" && worker.loadMs != null ? `loaded in ${duration(worker.loadMs)}` : "";
    text("worker-status", workerLabels[worker.workerPhase] + (extra ? ` · ${extra}` : ""));
  }
  text("page-status", page ? pageLabels[page.phase] : "No page activity. Open or reload a website to start.");
  optional("candidate", page?.current?.text);
  optional("error", page?.lastError);
  text("counts", page ? `${page.runs} checked · ${page.count} covered` : "");
  toggle.disabled = !page || toggling;
  toggle.textContent = page?.phase === "paused" ? "Resume" : "Pause";
  get("empty").hidden = Boolean(page?.activity.length);
  const key = JSON.stringify(page?.activity ?? []);
  if (key === activityKey) return;
  activityKey = key;
  const nodes = (page?.activity ?? []).map((event) => {
    const item = document.createElement("li");
    item.dataset.outcome = event.outcome;
    const title = document.createElement("strong");
    title.textContent = labels[event.outcome];
    const metrics = document.createElement("p");
    metrics.className = "metrics";
    metrics.textContent = `${percent(event.probability)} score · ${percent(event.cutoff)} cutoff · ${event.inputTokens} tokens · ${duration(event.inferenceMs)}`;
    const original = document.createElement("p");
    original.className = "original";
    original.textContent = event.text;
    item.append(title, metrics);
    if (event.outcome === "hidden") {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Show original";
      details.append(summary, original);
      item.append(details);
    } else item.append(original);
    return item;
  });
  feed.replaceChildren(...nodes);
}

async function refresh() {
  if (updating) return;
  updating = true;
  const version = generation;
  try {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (version !== generation) return;
    tabId = tab?.id;
    const [page, worker] = await Promise.all([
      tabId == null ? undefined : browser.tabs.sendMessage(tabId, { type: "page-status" }, { frameId: 0 }).catch(() => undefined),
      browser.runtime.sendMessage({ type: "worker-status" }).catch(() => undefined),
    ]);
    if (version === generation) render(page, worker);
  } finally { updating = false; }
}
function reset() {
  generation++;
  tabId = undefined;
  render();
}
browser.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) reset(); });
browser.tabs.onUpdated.addListener((id, change) => { if (id === tabId && change.status === "loading") reset(); });
toggle.addEventListener("click", async () => {
  if (tabId == null || toggling) return;
  toggling = true;
  toggle.disabled = true;
  try { await browser.tabs.sendMessage(tabId, { type: "toggle" }, { frameId: 0 }); }
  catch { reset(); }
  finally { toggling = false; void refresh(); }
});
get("settings").addEventListener("click", () => browser.runtime.openOptionsPage().catch(console.error));
// Poll only while Firefox has this panel open. Snapshots are bounded and live
// in the document being inspected, so a reload discards text with that page.
setInterval(refresh, 250);
void refresh();
