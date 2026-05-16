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

test("selection explain action creates an explanation prompt from selected text", () => {
  assert.match(
    buildReaderActionQuestion("explain", "Important sentence.").question,
    /Explain the selected passage[\s\S]*Important sentence/,
  );
});

test("selection translate action targets the preferred language", () => {
  withResponseLanguage("Korean", () => {
    assert.match(
      buildReaderActionQuestion("translate", "Bonjour").question,
      /Translate the selected passage into Korean[\s\S]*Bonjour/,
    );
  });
});

test("ask-ai action keeps selection context for a follow-up custom question", () => {
  assert.match(
    buildReaderActionQuestion("ask-ai", "Key paragraph").question,
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
