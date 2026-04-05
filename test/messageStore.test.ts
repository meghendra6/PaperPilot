import { test } from "node:test";
import * as assert from "node:assert/strict";

import { messageStore } from "../src/modules/message/messageStore";

function withPrefs(fn: () => void) {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => {
        if (key.endsWith("privacyStoreLocalHistory")) return true;
        if (key.endsWith("privacySavePromptsOnly")) return false;
        if (key.endsWith("privacySaveResponses")) return true;
        return true;
      },
    },
  };

  try {
    fn();
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
}

test("messageStore keeps in-memory context across turns", () => {
  withPrefs(() => {
    const sessionId = `session-${Date.now()}`;
    messageStore.append(sessionId, {
      role: "user",
      text: "Question 1",
      sourceMode: "codex_cli",
      status: "done",
    });
    messageStore.append(sessionId, {
      role: "assistant",
      text: "Answer 1",
      sourceMode: "codex_cli",
      status: "done",
    });

    const recent = messageStore.recent(sessionId, 2);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].text, "Question 1");
    assert.equal(recent[1].text, "Answer 1");

    messageStore.clear(sessionId);
  });
});

test("messageStore exposes raw history separately from filtered history", () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => {
        if (key.endsWith("privacyStoreLocalHistory")) return true;
        if (key.endsWith("privacySavePromptsOnly")) return true;
        if (key.endsWith("privacySaveResponses")) return false;
        return true;
      },
    },
  };

  try {
    const sessionId = `session-raw-${Date.now()}`;
    messageStore.append(sessionId, {
      role: "user",
      text: "Question raw",
      sourceMode: "codex_cli",
      status: "done",
    });
    messageStore.append(sessionId, {
      role: "assistant",
      text: "Answer raw",
      sourceMode: "codex_cli",
      status: "done",
    });

    assert.equal(messageStore.recent(sessionId, 2).length, 1);
    assert.equal(messageStore.recentRaw(sessionId, 2).length, 2);

    messageStore.clear(sessionId);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
