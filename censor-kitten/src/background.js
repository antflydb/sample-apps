import { Inference } from "./client/inference.js";

import { readPrompt } from "./settings.js";

const MODEL = "laya-multilingual";
const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "model_manifest.json", "model.safetensors"];
// Favor recall for this demo. These are model scores, not calibrated odds.
const CUTOFF = 0.18;
const IDLE_MS = 20_000;
let inference;
let busy = false;
let nextAt = 0;
let idle;
let loadMs;
let workerPhase = "cold";
let workingTab;
let loadStage;
const workerSnapshot = () => ({ workerPhase, workingTab, loadStage, loadMs });

async function load() {
  const start = performance.now();
  const client = await Inference.create({ assets: browser.runtime.getURL("runtime/") });
  try {
    const files = new Map(await Promise.all(FILES.map(async (name) => {
      const response = await fetch(browser.runtime.getURL(`model/${name}`));
      if (!response.ok) throw new Error(`Cannot read bundled ${name}: ${response.status}`);
      return [name, await response.blob()];
    })));
    await client.loadModel(files, { backend: "wasm", onProgress: ({ stage }) => { loadStage = stage; } });
    inference = client;
    loadMs = performance.now() - start;
  } catch (error) {
    client.dispose();
    throw error;
  }
}

async function classify(text, tabId, requestId) {
  if (busy || performance.now() < nextAt) return { retry: Math.max(100, Math.ceil(nextAt - performance.now())) };
  busy = true;
  workingTab = tabId;
  clearTimeout(idle);
  let started;
  try {
    if (!inference) {
      workerPhase = "loading";
      loadStage = "files";
      await load();
    }
    const instructions = await readPrompt();
    workerPhase = "running";
    started = performance.now();
    void browser.tabs.sendMessage(tabId, { type: "inference-started", requestId }, { frameId: 0 }).catch(() => {});
    const { value } = await inference.decide({
      model: MODEL, input: text,
      questions: [{ name: "distressing", type: "predicate", instructions }],
    });
    const answer = value.answers?.[0];
    if (answer?.type !== "predicate" || !Number.isFinite(answer.probability)) throw new Error("Missing predicate score");
    return { replace: answer.probability >= CUTOFF, probability: answer.probability, cutoff: CUTOFF,
      inputTokens: value.usage.input_tokens, inferenceMs: performance.now() - started, loadMs };
  } catch (error) {
    console.error("Censor Kitten:", error);
    return { error: error.message };
  } finally {
    // Serialize across tabs and leave a break between worker bursts.
    nextAt = performance.now() + Math.max(150, started === undefined ? 500 : (performance.now() - started) / 2);
    busy = false;
    workingTab = undefined;
    workerPhase = inference?.state.status === "ready" ? "ready" : inference ? "recovering" : "cold";
    idle = setTimeout(() => {
      inference?.dispose();
      inference = undefined;
      workerPhase = "cold";
    }, IDLE_MS);
  }
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "worker-status" && sender.url === browser.runtime.getURL("sidebar.html")) {
    return Promise.resolve(workerSnapshot());
  }
  if (sender.tab?.id === undefined || sender.frameId !== 0) return;
  if (msg?.type === "classify" && typeof msg.text === "string" && msg.text.length <= 320 &&
      typeof msg.requestId === "string") {
    return classify(msg.text, sender.tab.id, msg.requestId);
  }
  if (msg?.type === "badge") {
    const tabId = sender.tab.id;
    const text = msg.paused ? "OFF" : msg.failed ? "!" : msg.count ? String(msg.count) : "";
    return browser.browserAction.setBadgeText({ tabId, text });
  }
});

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle().catch(console.error);
});
