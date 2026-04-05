import { test } from "node:test";
import * as assert from "node:assert/strict";
import { normalizeResponseLanguage } from "../src/modules/translation/responseLanguage";

function buildQuestionForTest(
  action: string,
  text?: string,
  targetLanguage = "English",
) {
  const selected = text
    ? `

Selected text:
${text}`
    : "";
  switch (action) {
    case "explain":
      return `Explain the selected passage in the context of this paper.${selected}`;
    case "summarize":
      return `Summarize the selected passage in the context of this paper.${selected}`;
    case "translate":
      return `Translate the selected passage into ${targetLanguage}.${selected}`;
    default:
      return text
        ? `Ask a question about the selected passage.${selected}`
        : "Ask a question about this annotation.";
  }
}

test("selection explain action creates an explanation prompt from selected text", () => {
  assert.match(
    buildQuestionForTest("explain", "Important sentence."),
    /Explain the selected passage[\s\S]*Important sentence/,
  );
});

test("selection translate action targets the preferred language", () => {
  assert.match(
    buildQuestionForTest("translate", "Bonjour", "Korean"),
    /Translate the selected passage into Korean[\s\S]*Bonjour/,
  );
});

test("ask-ai action keeps selection context for a follow-up custom question", () => {
  assert.match(
    buildQuestionForTest("ask-ai", "Key paragraph"),
    /Ask a question about the selected passage[\s\S]*Key paragraph/,
  );
});

test("normalizeResponseLanguage only allows Korean, Chinese, or English", () => {
  assert.equal(normalizeResponseLanguage("Korean"), "Korean");
  assert.equal(normalizeResponseLanguage("Chinese"), "Chinese");
  assert.equal(normalizeResponseLanguage("English"), "English");
  assert.equal(normalizeResponseLanguage("Japanese"), "English");
  assert.equal(normalizeResponseLanguage(""), "English");
});
