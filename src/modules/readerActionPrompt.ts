import { getPref } from "../utils/prefs";
import { normalizeResponseLanguage } from "./translation/responseLanguage";

export type ReaderActionName =
  | "explain"
  | "summarize"
  | "translate"
  | "ask-ai"
  | "find-prior-work"
  | "annotation-ask"
  | "annotation-summarize"
  | "annotation-explain";

export function buildReaderActionQuestion(
  action: ReaderActionName,
  text?: string,
) {
  switch (action) {
    case "find-prior-work":
      return {
        question: text || "Find prior work for the current selection.",
        autoSubmit: false,
      };
    case "explain":
    case "annotation-explain":
      return {
        question: "Explain the selected passage in the context of this paper.",
        autoSubmit: true,
      };
    case "summarize":
    case "annotation-summarize":
      return {
        question:
          "Summarize the selected passage in the context of this paper.",
        autoSubmit: true,
      };
    case "translate": {
      const targetLanguage = normalizeResponseLanguage(
        getPref("responseLanguage"),
      );
      return {
        question: `Translate the selected passage into ${targetLanguage}.`,
        autoSubmit: true,
      };
    }
    case "annotation-ask":
    case "ask-ai":
    default:
      return {
        question: text
          ? "Ask a question about the selected passage."
          : "Ask a question about this annotation.",
        autoSubmit: false,
      };
  }
}
