import { test } from "node:test";
import * as assert from "node:assert/strict";
import { buildReaderActionQuestion } from "../src/modules/readerActionPrompt";
import { normalizeResponseLanguage } from "../src/modules/translation/responseLanguage";

function withResponseLanguage<T>(language: string, run: () => T) {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: () => language,
    },
  };

  try {
    return run();
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
}

test("selection explain action references selection data without duplicating it", () => {
  const question = buildReaderActionQuestion(
    "explain",
    "Important sentence.",
  ).question;
  assert.equal(
    question,
    "Explain the selected passage in the context of this paper.",
  );
  assert.doesNotMatch(question, /Important sentence/);
});

test("selection translate action targets the preferred language", () => {
  withResponseLanguage("Korean", () => {
    const question = buildReaderActionQuestion("translate", "Bonjour").question;
    assert.equal(question, "Translate the selected passage into Korean.");
    assert.doesNotMatch(question, /Bonjour/);
  });
});

test("ask-ai action leaves selection context in selection.json", () => {
  const question = buildReaderActionQuestion(
    "ask-ai",
    "Key paragraph",
  ).question;
  assert.equal(question, "Ask a question about the selected passage.");
  assert.doesNotMatch(question, /Key paragraph/);
});

test("find-prior-work action passes the selected text as the research concern", () => {
  const action = buildReaderActionQuestion(
    "find-prior-work",
    "A selected research limitation",
  );
  assert.equal(action.question, "A selected research limitation");
  assert.equal(action.autoSubmit, false);
});

test("normalizeResponseLanguage only allows Korean, Chinese, or English", () => {
  assert.equal(normalizeResponseLanguage("Korean"), "Korean");
  assert.equal(normalizeResponseLanguage("Chinese"), "Chinese");
  assert.equal(normalizeResponseLanguage("English"), "English");
  assert.equal(normalizeResponseLanguage("Japanese"), "English");
  assert.equal(normalizeResponseLanguage(""), "English");
});
