# Censor Kitten

A Firefox sample app for Antfly’s browser inference API. Laya checks prose near the viewport and covers distressing passages with clickable spoilers. The corner kitten sleeps between checks, scans its pupils during inference, and keeps its eyes open while any spoilers remain. Reduced motion disables the pupil animation.

## Build and run

Requires desktop Firefox 140+, Node.js 24+, pnpm 11.10.0, Zig 0.17.0, Python 3.11+, curl, and Git. The build fetches about 650 MiB of model data. Allow a few GiB for the prepared model, extension, and build output, plus space for Zig’s cache.

From the sample-apps repository root:

```sh
git clone https://github.com/antflydb/antfly.git ../antfly-runtime
git -C ../antfly-runtime checkout --detach adcfc0186283ef1eace4ffab93a9dcd135ce6a6b
export ANTFLY_ROOT="$(cd ../antfly-runtime && pwd)"
pnpm --dir "$ANTFLY_ROOT/ts" install --frozen-lockfile --filter @antfly/web
cd censor-kitten
node build.mjs
```

Use `ZIG=/path/to/zig` if the pinned Zig compiler isn't on `PATH`. `node build.mjs --reuse-runtime` skips compilation only when you already built `@antfly/web` and the CPU inference WASM from the same checkout. The sample builds from source; it does not require an Antfly server or use a released npm package.

1. In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose `censor-kitten/dist/manifest.json`. Remove any older Cheerwire prototype first so two extensions don’t scan the same page. The add-on unloads on browser restart.
2. Run `python3 benchmark.py --serve` from `censor-kitten/`. Open [Outbreak](http://127.0.0.1:8765/outbreak) for spoilers or [Cheese](http://127.0.0.1:8765/cheese) for neutral text. The first decision takes several seconds with the pinned CPU runtime.
3. Click or keyboard-activate a spoiler to reveal that block. Open **Censor Kitten** in the toolbar or Extensions menu to see model status, scores, and timings. **Pause** reveals the entire page.
4. In the sidebar, click **Edit model prompt**. Try `Is this about cheese?`, save, and reload the cheese page. Use **Restore default** to switch back. New checks use the saved prompt; reload the page to recheck text already seen.

## How it works

The content script chooses readable DOM blocks near the viewport, without a keyword gate. The background page loads the pinned [Laya multilingual checkpoint](https://huggingface.co/convaiinnovations/laya/tree/e333cb7c823cd1787276228260f56d02fbf5180b/multilingual) into an Antfly CPU WASM worker. It asks one yes/no question per block with `Inference.decide()`. When the score clears the demo cutoff, the content script covers the original text in place. Inline links inside a spoiler are disabled until reveal. Controls and images are not modified.

The extension needs access to HTTP and HTTPS pages to inspect and cover text. Page text, scores, and prompts are never transmitted; recent decisions are held in memory for the sidebar, and the custom prompt is stored locally. The build downloads public dependencies and weights; the installed add-on uses bundled files. This is a visual gag, not secure redaction: the original text remains in the page, and it can appear before inference finishes. The model can miss or over-cover text. Browser-internal pages, inaccessible frames, and text rendered into images or canvas are outside this example.

## Verify and measure

```sh
python3 benchmark.py --geckodriver /path/to/geckodriver
```

The benchmark runs headless desktop Firefox with and without the built add-on on the same local fixtures. It checks late-arriving spoilers and clean pages, and reports decision latency, process CPU time, summed RSS, and frame intervals. Summed RSS can double-count shared pages. The unoptimized CPU runtime is intentionally the pinned upstream build; budget several seconds per block, and expect the loaded model to use substantial memory. Treat this as a developer example, not a performance claim for everyday browsing.

## Licensing and distribution

The sample code and kitten artwork are [MIT licensed](../LICENSE). Antfly runtime code and Laya are Apache-2.0; the build includes the runtime notices and the pinned model card alongside their artifacts. The build locally prepares the checkpoint and compacts the tokenizer JSON without dropping entries. Weights and generated assets aren’t tracked in Git. This example is an unpacked development add-on, not a signed or AMO-distributed package.
