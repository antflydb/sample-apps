import { DEFAULT_PROMPT, MAX_PROMPT_LENGTH, PROMPT_KEY, readPrompt } from "./settings.js";

const form = document.querySelector("form");
const prompt = document.getElementById("prompt");
const save = document.getElementById("save");
const reset = document.getElementById("reset");
const status = document.getElementById("saved");
prompt.maxLength = MAX_PROMPT_LENGTH;

function disabled(value) { prompt.disabled = save.disabled = reset.disabled = value; }
async function persist(value) {
  const next = value.trim();
  if (!next) { status.textContent = "Enter a yes/no question."; return; }
  disabled(true);
  try {
    await browser.storage.local.set({ [PROMPT_KEY]: next });
    prompt.value = next;
    status.textContent = "Saved on this device.";
  } catch (error) {
    status.textContent = `Could not save: ${error.message}`;
  } finally { disabled(false); }
}
form.addEventListener("submit", (event) => { event.preventDefault(); void persist(prompt.value); });
reset.addEventListener("click", () => void persist(DEFAULT_PROMPT));
prompt.addEventListener("input", () => { status.textContent = ""; });
try { prompt.value = await readPrompt(); disabled(false); }
catch (error) { status.textContent = `Could not read settings: ${error.message}`; }
