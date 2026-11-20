export const DEFAULT_PROMPT = "Does this describe something bad happening?";
export const COVER_CUTOFF = 0.30;
export const MAX_TEXT = 240;
export const MAX_PROMPT_LENGTH = 240;
export const PROMPT_KEY = "decisionPrompt";

export async function readPrompt(get = key => browser.storage.local.get(key)) {
  const value = (await get(PROMPT_KEY))[PROMPT_KEY];
  return typeof value === "string" && value.trim() && value.length <= MAX_PROMPT_LENGTH ? value.trim() : DEFAULT_PROMPT;
}
