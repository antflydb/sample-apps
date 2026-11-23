import { Inference } from "./client/inference.js";

import { MAX_TEXT, readDecisionSettings } from "./settings.js";

const MODEL = "opendecider-nano";
const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "model_manifest.json", "model.safetensors"];
const BUSY_RETRY_MS = 75;
const IDLE_MS = 20_000;
let inference;
let busy = false;
let idle;
let loadMs;
let workerPhase = "cold";
let workingTab;
let loadStage;
const workerSnapshot = () => ({ workerPhase, workingTab, loadStage, loadMs, backend: inference?.state.model?.backend });

async function load() {
  const start = performance.now();
  const client = await Inference.create({ assets: chrome.runtime.getURL("runtime/") });
  try {
    const files = new Map(await Promise.all(FILES.map(async (name) => {
      const response = await fetch(chrome.runtime.getURL(`model/${name}`));
      if (!response.ok) throw new Error(`Cannot read bundled ${name}: ${response.status}`);
      return [name, await response.blob()];
    })));
    await client.loadModel(files, { backend: "webgpu", onProgress: ({ stage }) => { loadStage = stage; } });
    inference = client;
    loadMs = performance.now() - start;
  } catch (error) {
    client.dispose();
    throw error;
  }
}

async function classify(text, tabId, requestId, stored) {
  if (busy) return { retry: BUSY_RETRY_MS };
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
    const { instructions, cutoff } = await readDecisionSettings(() => stored);
    workerPhase = "running";
    started = performance.now();
    const event = { type: "inference-started", requestId };
    void chrome.runtime.sendMessage({ to: "relay", type: event.type, tabId, event }).catch(() => {});
    const { value } = await inference.decide({
      model: MODEL, input: text, questions: [{ name: "distressing", type: "predicate", instructions }],
    });
    const answer = value.answers?.[0];
    if (answer?.type !== "predicate" || !Number.isFinite(answer.probability)) throw new Error("Missing predicate score");
    const { probability } = answer;
    return { probability, instructions, cutoff, replace: probability >= cutoff,
      inputTokens: value.usage.input_tokens, inferenceMs: performance.now() - started, loadMs };
  } catch (error) {
    console.error("Censor Kitten:", error);
    return { error: error.message };
  } finally {
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

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (request?.to !== "offscreen" || sender.tab?.id >= 0) return;
  const { msg, tabId, stored } = request;
  if (msg?.type === "worker-status") {
    reply({ ...workerSnapshot(), elsewhere: tabId != null && workingTab !== tabId });
    return;
  }
  if (msg?.type === "classify" && typeof msg.text === "string" && msg.text.length <= MAX_TEXT &&
      typeof msg.requestId === "string") {
    classify(msg.text, tabId, msg.requestId, stored).then(reply, error => reply({ error: error.message }));
    return true;
  }
});
void chrome.runtime.sendMessage({ to: "relay", type: "ready" }).catch(() => {});
