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
  return [
    `Respond in ${language}. Write all reader-facing prose in ${language}, including summaries, explanations, findings, limitations, questions, feedback, and natural-language string values inside JSON.`,
    `Apply this language regardless of the language of the paper, prompt examples, or previous responses.`,
    "Keep JSON keys, enum values, schema-required literals, identifiers, code, URLs, citation locators, and verbatim source quotes unchanged. Preserve original paper titles and author names.",
    `Use English technical terms only when needed for precision; keep the surrounding sentences and explanations in ${language}.`,
  ].join(" ");
}
