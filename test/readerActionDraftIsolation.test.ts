import * as assert from "node:assert/strict";
import { test } from "node:test";
import { setReaderActionDraft } from "../src/modules/readerPane";
import {
  clearChatDrafts,
  getChatDraft,
  updateChatDraft,
} from "../src/modules/ui/chatDraft";

test("immediate reader action keeps the composer's distinct passage; Ask AI attaches deliberately", () => {
  const globals = globalThis as typeof globalThis & { addon?: unknown };
  const previous = globals.addon;
  const actions = new Map();
  globals.addon = { data: { readerActionDrafts: actions } };
  try {
    clearChatDrafts();
    const before = updateChatDraft(42, "session-B", {
      text: "My next question",
      context: { text: "Passage B", attachmentID: 202 },
    });
    const immediate = {
      itemID: 42,
      sessionId: "session-B",
      source: "selection-popup" as const,
      action: "explain",
      text: "Passage A",
      attachmentID: 101,
      updatedAt: "2026-09-07T00:00:00Z",
    };
    setReaderActionDraft(immediate, { attachToComposer: false });
    assert.deepEqual(getChatDraft(42, "session-B"), before);
    assert.equal(actions.get(42).attachmentID, 101);
    setReaderActionDraft({ ...immediate, action: "ask-ai" });
    assert.equal(getChatDraft(42, "session-B").text, before.text);
    assert.equal(getChatDraft(42, "session-B").context?.text, "Passage A");
  } finally {
    globals.addon = previous;
    clearChatDrafts();
  }
});
