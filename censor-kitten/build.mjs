import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { convertFp16 } from "./fp16.mjs";

const app = dirname(fileURLToPath(import.meta.url));
if (!process.env.ANTFLY_ROOT) throw new Error("Set ANTFLY_ROOT to the Antfly source checkout specified in README.md.");
const repo = resolve(process.env.ANTFLY_ROOT);
const zig = process.env.ZIG ?? "zig";
const web = join(repo, "ts/packages/web");
const cache = join(app, ".artifacts");
const model = join(cache, "nano-model");
const upstream = join(cache, "nano-input");
const repoId = "manjunathshiva/opendecider-nano";
const rev = "1e1f0a7322e446c5ae9bbe840df11680f18a752a";
const pins = {
  "config.json": "5dc491f5dafeb79b653c76cb3e5699a7958306ca8d85304f91ca16928c67dbaf",
  "opendecider.json": "ec0f4e9caa4cd95e2f30ab0e849cf62ce197ce0dcd3bf5fb1eb3eb12f7b480ba",
  "tokenizer.json": "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30",
  "tokenizer_config.json": "5926e6ec4294f80294bd98d9176defa9fbae7f140525d06a1da987488e74a973",
  "model.safetensors": "da243ae586e17ee87b5aa68e1bd06112c1c4cf756ea651d335ae7a2d6097cb38",
  "head.safetensors": "b57ad139c1ca8984a5205dc57aebeb921c9c59eaa536880d6b5e81d7734eee56",
};

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.status ?? result.signal}`);
}

async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

const policy = JSON.parse(await readFile(join(repo, "scripts/ci/toolchain-policy.json"), "utf8"));
const compiler = spawnSync(zig, ["version"], { encoding: "utf8" });
if (compiler.error) throw compiler.error;
if (compiler.status !== 0 || compiler.stdout.trim() !== policy.zig.version) {
  throw new Error(`This checkout requires Zig ${policy.zig.version}; set ZIG to that compiler.`);
}

if (!process.argv.includes("--reuse-runtime")) {
  run("pnpm", ["--filter", "@antfly/web", "build"], join(repo, "ts"));
  run(zig, ["build", "inference-wasm", "-Dmetal=false", "-j1"], join(repo, "zig"));
  run(zig, ["build", "inference-wasm", "-Dmetal=false", "-Dwebgpu=true", "-j1"], join(repo, "zig"));
}
const assets = join(web, "dist/runtime-assets");
const manifest = JSON.parse(await readFile(join(assets, "runtime-manifest.json"), "utf8"));
const { digest, sourceFingerprint, verifyWasm } = await import(pathToFileURL(join(web, "scripts/runtime-support.mjs")));
if (await sourceFingerprint(join(repo, "zig")) !== manifest.sourceFingerprint) throw new Error("Runtime JS does not match Antfly sources");
const wasmFiles = ["antfly-extraction-cpu.wasm", "antfly-extraction-webgpu.wasm"];
// The pinned SDK uses CPU WASM for checkpoint configuration and hashing, not inference.
const runtimes = new Map();
for (const name of wasmFiles) {
  const bytes = await verifyWasm(join(repo, "zig/zig-out", name), manifest.extractionAbiVersion);
  runtimes.set(name, bytes);
  manifest.files.push({ path: name, sha256: digest(bytes), size_bytes: bytes.length });
}

// This SDK can fall back even with backend: "webgpu". Reject before it starts
// a CPU inference worker; fail packaging if the pinned SDK layout changes.
const client = await readFile(join(web, "dist/inference.js"), "utf8");
const fallback = 'await runtime.init(new URL(this.gpu ? "antfly-extraction-webgpu.wasm" : "antfly-extraction-cpu.wasm", this.assets).href, {';
if (client.split(fallback).length !== 2) throw new Error("Cannot enforce WebGPU-only inference with this Antfly SDK");
const gpuClient = client.replace(fallback,
  'if (!this.gpu) throw new Error(`WebGPU is required: ${fallbackReason ?? "GPU initialization failed"}`);\n' +
  '            await runtime.init(new URL("antfly-extraction-webgpu.wasm", this.assets).href, {');

if (!(await exists(model))) {
  await mkdir(upstream, { recursive: true });
  for (const [name, expected] of Object.entries(pins)) {
    const target = join(upstream, name);
    if (!(await exists(target))) {
      run("curl", ["-fLsS", "--retry", "3", "--remove-on-error", `https://huggingface.co/${repoId}/resolve/${rev}/${name}`, "-o", target], app);
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest("hex") !== expected) throw new Error(`Bad checkpoint checksum: ${target}`);
  }
  run("python3", [join(repo, "scripts/laya/prepare_opendecider.py"), upstream, "--revision", rev, "--output", model], repo);
  await rm(upstream, { recursive: true, force: true });
}

const dist = join(app, "dist-chromium");
await rm(dist, { recursive: true, force: true });
await cp(join(app, "src"), dist, { recursive: true });
const kittenArt = await readFile(join(dist, "kitten.svg"), "utf8");
await writeFile(join(dist, "kitten-art.js"), `const CENSOR_KITTEN_SVG = ${JSON.stringify(kittenArt)};\n`);
await cp(assets, join(dist, "runtime"), { recursive: true });
await cp(join(web, "dist"), join(dist, "client"), {
  recursive: true,
  filter: (path) => path === join(web, "dist") || (dirname(path) === join(web, "dist") && path.endsWith(".js")),
});
await writeFile(join(dist, "client/inference.js"), gpuClient);
for (const [name, bytes] of runtimes) await writeFile(join(dist, "runtime", name), bytes);
await writeFile(join(dist, "runtime/runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await cp(join(app, "../LICENSE"), join(dist, "LICENSE"));
await cp(join(repo, "zig/zig-out/share/licenses/antfly-inference-wasm"), join(dist, "licenses"), { recursive: true });
for (const [name, hash, dest] of [
  ["README.md", "a6d75a6efd43b02e2911c1d3de81f8ee8f9be55fb3a3f48a892f457e9ef2853e", "licenses/OpenDecider-MODEL-CARD.md"],
  ["LICENSE", "30f149868450e5288b6ed3b6fc0257a9597b5ffcdd961fdf3863a14a40b63b8d", "licenses/OpenDecider-LICENSE"],
]) {
  const response = await fetch(`https://huggingface.co/${repoId}/resolve/${rev}/${name}`);
  if (!response.ok) throw new Error(`Could not fetch pinned ${name}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== hash) throw new Error(`Bad OpenDecider ${name} checksum`);
  await writeFile(join(dist, dest), bytes);
}
await cp(model, join(dist, "model"), { recursive: true, mode: constants.COPYFILE_FICLONE,
  filter: path => path !== join(model, "model.safetensors"),
});
const modelManifestPath = join(dist, "model/model_manifest.json");
const modelManifest = JSON.parse(await readFile(modelManifestPath, "utf8"));
modelManifest.source = { repository: repoId, revision: rev };
await writeFile(modelManifestPath, JSON.stringify(modelManifest, null, 2) + "\n");
const weight = "model.safetensors";
await convertFp16(join(model, weight), join(dist, "model", weight));
console.log(`Unpacked Chromium add-on: ${join(dist, "manifest.json")}`);
