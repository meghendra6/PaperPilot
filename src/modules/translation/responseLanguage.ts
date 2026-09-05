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
    `Respond in ${language}. Write reader-facing prose in ${language}, including summaries, explanations, findings, limitations, questions, feedback, and natural-language string values inside JSON, following the terminology policy below.`,
    `Apply this language regardless of the language of the paper, prompt examples, or previous responses.`,
    "Keep JSON keys, enum values, schema-required literals, identifiers, code, URLs, citation locators, and verbatim source quotes unchanged. Preserve original paper titles and author names.",
    language === "Korean"
      ? [
          "Use English technical terms by default in Korean responses. Preserve English terminology from the paper and the reader's question, and use conventional English names for domain concepts, methods, metrics, and acronyms.",
          "Keep terms such as probability distribution, rejection sampling, and KV cache in English. Do not replace them with Korean translations or phonetic transliterations, or routinely add Korean equivalents or bilingual parenthetical glosses.",
          "Explain concepts directly in natural Korean sentences using those English terms; avoid forced word-for-word translation of technical explanations. Briefly clarify unfamiliar concepts in context when helpful. Translate a technical term only when the reader explicitly requests its Korean wording.",
        ].join(" ")
      : `Use English technical terms only when needed for precision; keep the surrounding sentences and explanations in ${language}.`,
  ].join(" ");
}

// Open reader panes refresh presentation copy when settings change. The active
// CLI run keeps its captured execution settings and generated text unchanged.
const languageChangeListeners = new Set<() => void>();

export function notifyResponseLanguageChanged(): void {
  for (const listener of languageChangeListeners) listener();
}

export function subscribeToResponseLanguageChanges(
  listener: () => void,
): () => void {
  languageChangeListeners.add(listener);
  return () => {
    languageChangeListeners.delete(listener);
  };
}
