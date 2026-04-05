export const SUPPORTED_RESPONSE_LANGUAGES = [
  "English",
  "Korean",
  "Chinese",
] as const;

export type SupportedResponseLanguage =
  (typeof SUPPORTED_RESPONSE_LANGUAGES)[number];

export function normalizeResponseLanguage(
  value: unknown,
): SupportedResponseLanguage {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "korean":
      return "Korean";
    case "chinese":
      return "Chinese";
    case "english":
    default:
      return "English";
  }
}

export function buildResponseLanguageInstruction(value: unknown) {
  const language = normalizeResponseLanguage(value);
  return `Respond in ${language}. Use English technical terms for technical terminology where appropriate.`;
}
