import { getPref } from "../utils/prefs";
import { normalizeResponseLanguage } from "./translation/responseLanguage";

export type ReaderActionName =
  | "explain"
  | "summarize"
  | "translate"
  | "ask-ai"
  | "annotation-ask"
  | "annotation-summarize"
  | "annotation-explain";

export function buildReaderActionQuestion(
  action: ReaderActionName,
  text?: string,
) {
  const selected = text
    ? `

Selected text:
${text}`
    : "";
  switch (action) {
    case "explain":
    case "annotation-explain":
      return {
        question: `Explain the selected passage in the context of this paper.${selected}`,
        autoSubmit: true,
      };
    case "summarize":
    case "annotation-summarize":
      return {
        question: `Summarize the selected passage in the context of this paper.${selected}`,
        autoSubmit: true,
      };
    case "translate": {
      const targetLanguage = normalizeResponseLanguage(
        getPref("responseLanguage"),
      );
      return {
        question: `Translate the selected passage into ${targetLanguage}.${selected}`,
        autoSubmit: true,
      };
    }
    case "annotation-ask":
    case "ask-ai":
    default:
      return {
        question: text
          ? `Ask a question about the selected passage.${selected}`
          : "Ask a question about this annotation.",
        autoSubmit: false,
      };
  }
}
