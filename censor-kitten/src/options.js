import { COVER_CUTOFF, CUTOFF_KEY, DECISION_KEYS, DEFAULT_PROMPT, MAX_PROMPT_LENGTH, PROMPT_KEY, readDecisionSettings } from "./settings.js";

const form = document.querySelector("form");
const prompt = document.getElementById("prompt");
const cutoff = document.getElementById("cutoff");
const save = document.getElementById("save");
const reset = document.getElementById("reset");
const status = document.getElementById("saved");
prompt.maxLength = MAX_PROMPT_LENGTH;

function disabled(value) { prompt.disabled = cutoff.disabled = save.disabled = reset.disabled = value; }
function fill(instructions, threshold) {
  prompt.value = instructions;
  cutoff.value = (threshold * 100).toFixed(1);
}
async function persist(instructions, threshold, restore = false) {
  if (!instructions) { status.textContent = "Enter a yes/no question."; return; }
  disabled(true);
  try {
    if (restore) await browser.storage.local.remove(DECISION_KEYS);
    else await browser.storage.local.set({
      [PROMPT_KEY]: instructions === DEFAULT_PROMPT ? null : instructions,
      [CUTOFF_KEY]: threshold === COVER_CUTOFF ? null : threshold,
    });
    fill(instructions, threshold);
    status.textContent = "Saved on this device.";
  } catch (error) {
    status.textContent = `Could not save: ${error.message}`;
  } finally { disabled(false); }
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void persist(prompt.value.trim(), cutoff.valueAsNumber / 100);
});
reset.addEventListener("click", () => void persist(DEFAULT_PROMPT, COVER_CUTOFF, true));
form.addEventListener("input", () => { status.textContent = ""; });
try {
  const { instructions, cutoff: threshold } = await readDecisionSettings();
  fill(instructions, threshold);
  disabled(false);
}
catch (error) { status.textContent = `Could not read settings: ${error.message}`; }
