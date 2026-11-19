import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = dirname(fileURLToPath(import.meta.url));
if (!process.env.ANTFLY_ROOT) throw new Error("Set ANTFLY_ROOT to the Antfly source checkout specified in README.md.");
const repo = resolve(process.env.ANTFLY_ROOT);
const zig = process.env.ZIG ?? "zig";
const web = join(repo, "ts/packages/web");
const cache = join(app, ".artifacts");
const model = join(cache, "laya");
const upstream = join(cache, "laya-upstream");
const repoId = "convaiinnovations/laya";
const rev = "e333cb7c823cd1787276228260f56d02fbf5180b";
const pins = {
  "encoder/config.json": "83f6916d13ef0f556ac461f28308dc2bffa7ebeadee8ec9e2db5812020ea5bb4",
  "rl_agent_config.json": "25061739243b617ad88d1219ba6f8a9c86c5881ca28df024fa2d9b3b2fcc30c6",
  "tokenizer/tokenizer_config.json": "6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1",
  "tokenizer/tokenizer.json": "609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f",
  "model.safetensors": "9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204",
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
}
const assets = join(web, "dist/runtime-assets");
const manifest = JSON.parse(await readFile(join(assets, "runtime-manifest.json"), "utf8"));
const { digest, sourceFingerprint, verifyWasm } = await import(pathToFileURL(join(web, "scripts/runtime-support.mjs")));
if (await sourceFingerprint(join(repo, "zig")) !== manifest.sourceFingerprint) throw new Error("Runtime JS does not match Antfly sources");
const wasmName = "antfly-extraction-cpu.wasm";
const wasm = await verifyWasm(join(repo, "zig/zig-out", wasmName), manifest.extractionAbiVersion);
manifest.files.push({ path: wasmName, sha256: digest(wasm), size_bytes: wasm.length });

if (!(await exists(model))) {
  await mkdir(join(upstream, "encoder"), { recursive: true });
  await mkdir(join(upstream, "tokenizer"), { recursive: true });
  for (const [name, expected] of Object.entries(pins)) {
    const target = join(upstream, name);
    if (!(await exists(target))) {
      run("curl", ["-fLsS", "--retry", "3", "--remove-on-error", `https://huggingface.co/${repoId}/resolve/${rev}/multilingual/${name}`, "-o", target], app);
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest("hex") !== expected) throw new Error(`Bad checkpoint checksum: ${target}`);
  }
  run("python3", [join(repo, "scripts/laya/prepare_laya.py"), upstream, "--revision", rev, "--output", model], repo);
  await rm(upstream, { recursive: true, force: true });
}

const dist = join(app, "dist");
await rm(dist, { recursive: true, force: true });
await cp(join(app, "src"), dist, { recursive: true });
const kittenArt = await readFile(join(dist, "kitten.svg"), "utf8");
await writeFile(join(dist, "kitten-art.js"), `const CENSOR_KITTEN_SVG = ${JSON.stringify(kittenArt)};\n`);
await cp(assets, join(dist, "runtime"), { recursive: true });
await cp(join(web, "dist"), join(dist, "client"), {
  recursive: true,
  filter: (path) => path === join(web, "dist") || (dirname(path) === join(web, "dist") && path.endsWith(".js")),
});
await writeFile(join(dist, "runtime", wasmName), wasm);
await writeFile(join(dist, "runtime/runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await cp(join(app, "../LICENSE"), join(dist, "LICENSE"));
await cp(join(repo, "zig/zig-out/share/licenses/antfly-inference-wasm"), join(dist, "licenses"), { recursive: true });
const card = await fetch(`https://huggingface.co/${repoId}/resolve/${rev}/README.md`);
if (!card.ok) throw new Error(`Could not fetch the pinned Laya model card: ${card.status}`);
const cardBytes = Buffer.from(await card.arrayBuffer());
if (digest(cardBytes) !== "135828ba3ae068893a419f4498cff10a0b37097c85130142573069ba3ade7876") {
  throw new Error("Bad Laya model card checksum");
}
await writeFile(join(dist, "licenses", "Laya-MODEL-CARD.md"), cardBytes);
await cp(model, join(dist, "model"), { recursive: true, mode: constants.COPYFILE_FICLONE });
await cp(join(repo, "LICENSE"), join(dist, "model/LICENSE"));
// This checkpoint's pretty-printed tokenizer exceeds Antfly's 32 MiB limit.
// Compact JSON keeps the full vocabulary, merges and special tokens unchanged.
const tokenizer = join(dist, "model/tokenizer.json");
await writeFile(tokenizer, JSON.stringify(JSON.parse(await readFile(tokenizer, "utf8"))));
const modelManifestPath = join(dist, "model/model_manifest.json");
const modelManifest = JSON.parse(await readFile(modelManifestPath, "utf8"));
modelManifest.source = { repository: repoId, revision: rev, variant: "multilingual" };
await writeFile(modelManifestPath, JSON.stringify(modelManifest, null, 2) + "\n");
console.log(`Temporary Firefox add-on: ${join(dist, "manifest.json")}`);
