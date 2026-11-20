// Run against the actual packaged CPU WASM; this is a scorecard, not a claim of calibration.
import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_CUTOFF, DEFAULT_PROMPT, MAX_TEXT } from './src/settings.js';
import { ExtractionSession } from './dist/runtime/runtime/extraction-session.js';
import { createWasmAbi } from './dist/runtime/runtime/wasm-abi.js';

const corpus = JSON.parse(await readFile(new URL('./decision-cases.json', import.meta.url), 'utf8'));
const weights = process.env.MODEL_DIR ?? fileURLToPath(new URL('./dist/model', import.meta.url));
const bytes = await readFile(new URL('./dist/runtime/antfly-extraction-cpu.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: {} });
const session = new ExtractionSession(instance.exports, createWasmAbi(instance.exports));
const names = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'model_manifest.json', 'model.safetensors'];
// The runtime uses the packaged standalone WASM to read tensor metadata, too.
const fetchFromNetwork = globalThis.fetch;
globalThis.fetch = (url, ...args) => new URL(url).protocol === 'file:'
  ? Promise.resolve(new Response(bytes)) : fetchFromNetwork(url, ...args);
const loadStart = performance.now();
await session.load(new Map(await Promise.all(names.map(async (name) => [name, await openAsBlob(resolve(weights, name))]))));
const loadMs = Math.round(performance.now() - loadStart);
try {
  const prompts = process.argv.length > 2 ? process.argv.slice(2) : [DEFAULT_PROMPT];
  const cutoff = Number(process.env.CUTOFF ?? COVER_CUTOFF);
  for (const instructions of prompts) {
    const correct = { cover: 0, keep: 0 };
    const mistakes = [];
    const elapsed = [];
    for (const [expected, cases] of Object.entries(corpus)) {
      for (const [name, input] of Object.entries(cases)) {
        const start = performance.now();
        const { answers: [answer] } = session.run({ model: 'local', input: input.slice(0, MAX_TEXT),
          questions: [{ name: 'distressing', type: 'predicate', instructions }] }, false, 'decide').value;
        elapsed.push(performance.now() - start);
        const probability = answer.probability;
        if (!Number.isFinite(probability)) throw new Error(`Invalid score for ${name}`);
        if ((probability >= cutoff) === (expected === 'cover')) correct[expected]++;
        else mistakes.push({ name, expected, score: probability });
      }
    }
    elapsed.sort((a, b) => a - b);
    console.log(JSON.stringify({ instructions, cutoff, cover: `${correct.cover}/${Object.keys(corpus.cover).length}`,
      keep: `${correct.keep}/${Object.keys(corpus.keep).length}`, loadMs, medianCallMs: Math.round(elapsed[Math.floor(elapsed.length / 2)]), mistakes }, null, 2));
  }
} finally {
  session.unload();
}
