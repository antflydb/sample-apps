export const DEFAULT_PROMPT = "Does this mention anything sensitive or upsetting?";
export const COVER_CUTOFF = 0.34;
export const MAX_TEXT = 1000;
export const MAX_PROMPT_LENGTH = 240;
export const PROMPT_KEY = "decisionPrompt";
export const CUTOFF_KEY = "decisionCutoff";
export const DECISION_KEYS = [PROMPT_KEY, CUTOFF_KEY];
export const PAUSE_KEY = "paused";

export async function readDecisionSettings(get = keys => browser.storage.local.get(keys)) {
  const { [PROMPT_KEY]: prompt, [CUTOFF_KEY]: cutoff } = await get(DECISION_KEYS);
  return {
    instructions: typeof prompt === "string" && prompt.trim() && prompt.length <= MAX_PROMPT_LENGTH ? prompt.trim() : DEFAULT_PROMPT,
    cutoff: Number.isFinite(cutoff) && cutoff >= 0 && cutoff <= 1 ? cutoff : COVER_CUTOFF,
  };
}
