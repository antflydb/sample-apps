# Censor Kitten

A Firefox and Chromium sample app for Antfly’s browser inference API. OpenDecider Nano checks prose near the viewport and covers potentially objectionable text with clickable spoilers. The corner kitten sleeps between checks, alternates between two glances during inference, and keeps its eyes open while any spoilers remain. Reduced motion disables the pupil animation.

## Build and run

Requires desktop Firefox 147+ (for anchored headline spoilers), Node.js 24+, pnpm 11.10.0, Zig 0.17.0, Python 3.11+, curl, and Git. The build fetches about 760 MiB of model data. Allow a few GiB for the prepared model, extension, and build output, plus space for Zig’s cache.

From the sample-apps repository root:

```sh
git clone https://github.com/antflydb/antfly.git ../antfly-runtime
git -C ../antfly-runtime checkout --detach bd4960d1fdfc0f13ca3072d3784f7bad905a6900
export ANTFLY_ROOT="$(cd ../antfly-runtime && pwd)"
pnpm --dir "$ANTFLY_ROOT/ts" install --frozen-lockfile --filter @antfly/web
cd censor-kitten
node build.mjs
```

Use `ZIG=/path/to/zig` if the pinned Zig compiler isn't on `PATH`. `node build.mjs --reuse-runtime` packages already-built `@antfly/web` and CPU WASM from the same checkout without compiling them. [Antfly v0.3.1](https://github.com/antflydb/antfly/releases/tag/v0.3.1) does not publish the matching browser runtime, so its native binaries cannot substitute for these assets. The installed extension does not require an Antfly server.

For the local performance demo, set `CENSOR_KITTEN_DEMO_WASM` to the existing `cheerwire/.artifacts/browser-bench/candidate.wasm` and run `node build.mjs --reuse-runtime`. The build accepts only the pinned SHA-256 and its matching Antfly JavaScript. This is the prototype's benchmark kernel (a four-column tile and separate multiply/add), not an official Antfly release. The default build still uses upstream WASM.

1. In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose `censor-kitten/dist/manifest.json`. Remove any older Cheerwire prototype first so two extensions don’t scan the same page. The add-on unloads on browser restart.
2. Run `python3 benchmark.py --serve` from `censor-kitten/`. Open [Haiti](http://127.0.0.1:8765/haiti) or [Outbreak](http://127.0.0.1:8765/outbreak) for spoilers, or [Cheese](http://127.0.0.1:8765/cheese) for neutral text. The first decision takes several seconds with the pinned CPU runtime.
3. Click or keyboard-activate a spoiler to reveal that block. Click the kitten to toggle the on-page panel, or use the toolbar or Extensions menu for the native Firefox sidebar. Both show the evaluated text, scores, and timings. **Pause** above the decision log reveals covered text and stops checking in every tab until you click **Resume**, even after navigation or reload.
4. Click **Edit decision settings** to change the question or the decision threshold. Lower the threshold to cover more text; raise it to cover less. Both settings are stored locally. **Restore defaults** resets both. Reload a page to recheck its text with new settings. Each decision shows the actual question and threshold used.

### Chromium

Run `node build.mjs --chromium` instead. In Chromium 131+, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked** → `censor-kitten/dist-chromium`. Click the toolbar icon for the browser side panel or the kitten for the on-page panel.

This target builds matching CPU and WebGPU WASM and converts the pinned BF16 checkpoint to FP16 locally. Chromium prefers WebGPU where supported and chooses CPU WASM otherwise. The sidebar shows the actual backend after loading. If both WASM artifacts and the matching `@antfly/web` client are already built, use `--chromium --reuse-runtime`.

## How it works

The content script chooses readable DOM blocks near the viewport, without a keyword gate, and prioritizes linked headlines and prose. An anchored spoiler sits over a linked headline without nesting a button in the link. The background loads the pinned [OpenDecider Nano checkpoint](https://huggingface.co/manjunathshiva/opendecider-nano/tree/1e1f0a7322e446c5ae9bbe840df11680f18a752a) and sends up to 1,000 characters from each block to one `Inference.decide()` call with one predicate: **Does this mention anything sensitive or upsetting?** The longer excerpt lets the model see details that appear late in a paragraph. The default 34% threshold is an operating point from the demo corpus, not calibrated odds. Inline links inside a covered paragraph are disabled until reveal. Images are not modified.

The extension needs access to HTTP and HTTPS pages to inspect and cover text. Page text, scores, and prompts are never transmitted; recent decisions are held in memory for the sidebar, and settings and pause state are stored locally. The build downloads public dependencies and weights; the installed add-on uses bundled files. This is a visual gag, not secure redaction: the original text remains in the page, and it can appear before inference finishes. The model can miss or over-cover text. Browser-internal pages, inaccessible frames, and text rendered into images or canvas are outside this example.

## Verify and measure

```sh
python3 benchmark.py --geckodriver /path/to/geckodriver
```

Run `node evaluate.mjs` to score the packaged model on the labeled English examples in `decision-cases.json`, including excerpts from [Signal](https://signal.org/download/), [Ukraine](https://en.wikipedia.org/wiki/Ukraine), the [Python tutorial](https://docs.python.org/3/tutorial/introduction.html), [NHS bereavement advice](https://www.nhs.uk/mental-health/feelings-symptoms-behaviours/feelings-and-symptoms/grief-bereavement-loss/), and [Stonewall riots](https://en.wikipedia.org/wiki/Stonewall_riots). It reports misses and false covers separately, plus model load time and median WASM call time. Pass questions as positional arguments or set `CUTOFF` to a fraction to compare alternatives. The corpus is a check on the demo's behavior, not a production moderation evaluation or evidence of quality in other languages.

The benchmark runs headless desktop Firefox with and without the built add-on on the same local fixtures. It checks late-arriving spoilers and clean pages, and reports decision latency, process CPU time, summed RSS, and frame intervals. Summed RSS can double-count shared pages. The unoptimized CPU runtime is intentionally the pinned upstream build; budget several seconds per block, and expect the loaded model to use substantial memory. Treat this as a developer example, not a performance claim for everyday browsing.

Firefox is CPU-only. A separate Chromium 149 run on Apple Metal used Antfly `bd4960d1fd` and an FP16 conversion of Nano's published BF16 checkpoint. In that earlier 41-case benchmark, all CPU/GPU cover decisions agreed. Warm median wall time was 823 ms on the optimized CPU runtime and 40 ms on WebGPU. Model load took about 2.9 s on either backend; a cold GPU first call can also incur shader initialization. These measurements are from a local browser harness, not the extension or the current corpus.

## Licensing and distribution

The sample code and kitten artwork are [MIT licensed](../LICENSE). Antfly runtime code and OpenDecider Nano are Apache-2.0; the build includes runtime notices and the pinned model card and license. The build merges the verified encoder and decision head into one local checkpoint. Weights and generated assets aren’t tracked in Git. This example is an unpacked development add-on, not a signed or AMO-distributed package.
