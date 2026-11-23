# Censor Kitten

A Chromium extension for Antfly’s browser inference API. OpenDecider Nano checks prose near the viewport and covers potentially objectionable text with clickable spoilers. The corner kitten sleeps between checks, alternates between two glances during inference, and keeps its eyes open while any spoilers remain. Reduced motion disables the pupil animation.

## Build and run

Requires desktop Chromium 131+ with working WebGPU. To package from source, use Node.js 24+, pnpm 11.10.0, Zig 0.17.0, Python 3.11+, curl, and Git. The build fetches about 760 MiB of model data. Allow a few GiB for the prepared model, extension, and build output, plus space for Zig’s cache.

From the sample-apps repository root:

```sh
git clone https://github.com/antflydb/antfly.git ../antfly-runtime
git -C ../antfly-runtime checkout --detach bd4960d1fdfc0f13ca3072d3784f7bad905a6900
export ANTFLY_ROOT="$(cd ../antfly-runtime && pwd)"
pnpm --dir "$ANTFLY_ROOT/ts" install --frozen-lockfile --filter @antfly/web
cd censor-kitten
node build.mjs
```

Use `ZIG=/path/to/zig` if the pinned compiler isn't on `PATH`. `node build.mjs --reuse-runtime` packages matching, already-built `@antfly/web` and WASM artifacts from the same checkout. The installed extension bundles the Antfly runtime and model and does not require an Antfly server.

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked** → `censor-kitten/dist-chromium`.
2. Run `python3 serve.py` from `censor-kitten/`. Open [Haiti](http://127.0.0.1:8765/haiti) or [Outbreak](http://127.0.0.1:8765/outbreak) for spoilers, or [Cheese](http://127.0.0.1:8765/cheese) for neutral text.
3. Click or keyboard-activate a spoiler to reveal that block. Click the toolbar icon for the browser side panel or the kitten for the on-page panel. Both show the evaluated text, scores, and timings. **Pause** above the decision log reveals covered text and stops checking in every tab until you click **Resume**, even after navigation or reload.
4. Click **Edit decision settings** to change the question or the decision threshold. Lower the threshold to cover more text; raise it to cover less. Both settings are stored locally. **Restore defaults** resets both. Reload a page to recheck its text with new settings. Each decision shows the actual question and threshold used.

Inference requires WebGPU. If the GPU backend cannot initialize, the panel displays an error and leaves page text untouched. The package still includes CPU WASM because the pinned Antfly SDK uses it to inspect and verify the checkpoint; it is never used for inference.

## How it works

The content script chooses readable DOM blocks near the viewport, without a keyword gate, and prioritizes linked headlines and prose. An anchored spoiler sits over a linked headline without nesting a button in the link. The background loads the pinned [OpenDecider Nano checkpoint](https://huggingface.co/manjunathshiva/opendecider-nano/tree/1e1f0a7322e446c5ae9bbe840df11680f18a752a) and sends up to 1,000 characters from each block to one `Inference.decide()` call with one predicate: **Does this mention anything sensitive or upsetting?** The longer excerpt lets the model see details that appear late in a paragraph. The default 34% threshold is an operating point from the demo corpus, not calibrated odds. Inline links inside a covered paragraph are disabled until reveal. Images are not modified.

The extension needs access to HTTP and HTTPS pages to inspect and cover text. Page text, scores, and prompts are never transmitted; recent decisions are held in memory for the sidebar, and settings and pause state are stored locally. The build downloads public dependencies and weights; the installed add-on uses bundled files. This is a visual gag, not secure redaction: the original text remains in the page, and it can appear before inference finishes. The model can miss or over-cover text. Browser-internal pages, inaccessible frames, and text rendered into images or canvas are outside this example.

## Calibration

`decision-cases.json` records labeled English excerpts used to tune the default question and threshold, including passages from [Signal](https://signal.org/download/), [Ukraine](https://en.wikipedia.org/wiki/Ukraine), the [Python tutorial](https://docs.python.org/3/tutorial/introduction.html), [NHS bereavement advice](https://www.nhs.uk/mental-health/feelings-symptoms-behaviours/feelings-and-symptoms/grief-bereavement-loss/), and [Stonewall riots](https://en.wikipedia.org/wiki/Stonewall_riots). It is not a production moderation evaluation or evidence of quality in other languages.

## Licensing and distribution

The sample code and kitten artwork are [MIT licensed](../LICENSE). Antfly runtime code and OpenDecider Nano are Apache-2.0; the build includes runtime notices and the pinned model card and license. The build merges the verified encoder and decision head into one checkpoint and converts its weights to FP16. Weights and generated assets aren’t tracked in Git. This example is an unpacked development extension, not a store release.
