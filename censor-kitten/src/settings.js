export const DEFAULT_PROMPT = "Is this bad news or a distressing situation?";
export const MAX_PROMPT_LENGTH = 240;
export const PROMPT_KEY = "decisionPrompt";

export async function readPrompt() {
  const value = (await browser.storage.local.get(PROMPT_KEY))[PROMPT_KEY];
  return typeof value === "string" && value.trim() && value.length <= MAX_PROMPT_LENGTH ? value.trim() : DEFAULT_PROMPT;
}
