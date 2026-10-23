import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearChatDrafts,
  consumeChatDraft,
  getChatDraft,
  restoreChatDraft,
  updateChatDraft,
  createChatDraftSubmission,
  formatDraftAnnotationNotice,
  formatDraftSourceLabel,
  recordedContextForRun,
  shouldReadLiveSelection,
} from "../src/modules/ui/chatDraft";

test("draft revisions preserve the next question while the previous request settles", () => {
  clearChatDrafts();
  const first = updateChatDraft(1, "a", {
    text: "First",
    context: { attachmentID: 22, text: "quote" },
  });
  assert.equal(consumeChatDraft(1, "a", first.revision), true);
  updateChatDraft(1, "a", { text: "Second" });
  assert.equal(restoreChatDraft(1, "a", first), false);
  assert.equal(getChatDraft(1, "a").text, "Second");
  assert.equal(getChatDraft(1, "a").context, undefined);
});
test("editing a restored question, source or length detaches the failed submission", () => {
  clearChatDrafts();
  for (const patch of [
    { text: "Edited" },
    { context: { attachmentID: 8 } },
    { responseLength: "detailed" as const },
  ]) {
    const admitted = updateChatDraft(3, "s", {
      text: "Original",
      responseLength: "short",
      context: undefined,
    });
    const submission = createChatDraftSubmission({
      question: "Original",
      responseLength: "short",
    });
    consumeChatDraft(3, "s", admitted.revision);
    restoreChatDraft(3, "s", admitted, submission);
    assert.equal(getChatDraft(3, "s").submission?.turnId, submission.turnId);
    updateChatDraft(3, "s", patch);
    assert.equal(getChatDraft(3, "s").submission, undefined);
  }
});
test("preparation failures restore a consumed draft without crossing sessions or papers", () => {
  clearChatDrafts();
  const first = updateChatDraft(1, "a", {
    text: "First",
    responseLength: "short",
  });
  consumeChatDraft(1, "a", first.revision);
  assert.equal(restoreChatDraft(1, "a", first), true);
  assert.equal(getChatDraft(1, "a").text, "First");
  assert.equal(getChatDraft(1, "b").text, "");
  assert.equal(getChatDraft(2, "a").text, "");
  const stale = getChatDraft(1, "a");
  updateChatDraft(1, "a", { context: { attachmentID: 33 } });
  assert.equal(consumeChatDraft(1, "a", stale.revision), false);
});

test("the draft card names its source by title, not by internal item ID", () => {
  assert.equal(
    formatDraftSourceLabel({
      paperTitle: "Attention Is All You Need",
      attachmentTitle: "Full Text PDF",
    }),
    "Paper: Attention Is All You Need · Full Text PDF",
  );
  assert.equal(
    formatDraftSourceLabel({ paperTitle: "Same", attachmentTitle: "Same" }),
    "Paper: Same",
  );
  assert.equal(formatDraftSourceLabel({}), "Paper: Current paper");
  assert.doesNotMatch(formatDraftAnnotationNotice(), /\d/);
  assert.match(formatDraftAnnotationNotice("Full Text PDF"), /“Full Text PDF”/);
  assert.match(formatDraftAnnotationNotice(), /from the PDF at send time/);
});

test("only a typed question with the pane's own record reads the live selection", () => {
  const paneOpen = { attachmentID: 7, text: "", origin: "pane-open" as const };
  assert.equal(
    shouldReadLiveSelection({ context: paneOpen, visibleChat: true }),
    true,
  );
  assert.equal(
    shouldReadLiveSelection({ context: undefined, visibleChat: true }),
    true,
  );
  // Hidden workflow runs never pick up a stray highlight.
  assert.equal(
    shouldReadLiveSelection({ context: paneOpen, visibleChat: false }),
    false,
  );
  // "Remove context" keeps the PDF but clears the passage on purpose.
  assert.equal(
    shouldReadLiveSelection({
      context: { attachmentID: 7, text: "" },
      visibleChat: true,
    }),
    false,
  );
  // A recorded passage or annotation is used as recorded.
  assert.equal(
    shouldReadLiveSelection({
      context: { ...paneOpen, text: "recorded" },
      visibleChat: true,
    }),
    false,
  );
  assert.equal(
    shouldReadLiveSelection({
      context: { attachmentID: 7, annotationIDs: ["A"] },
      visibleChat: true,
    }),
    false,
  );
});

test("hidden workflow runs keep only the bound PDF from a recorded context", () => {
  const leftover = {
    text: "Leftover highlighted sentence from page 9",
    annotationIDs: ["ANNOT1"],
    attachmentID: 7,
    pageIndex: 8,
    pageLabel: "9",
  };
  assert.deepEqual(
    recordedContextForRun({ context: leftover, visibleChat: false }),
    { attachmentID: 7 },
  );
  assert.deepEqual(
    recordedContextForRun({ context: leftover, visibleChat: true }),
    leftover,
  );
  assert.equal(
    recordedContextForRun({ context: { text: "x" }, visibleChat: false }),
    undefined,
  );
});

test("a preparation failure restores the question after pane-owned draft writes", () => {
  const itemID = 9001;
  const sessionId = "session-restore";
  const admitted = updateChatDraft(itemID, sessionId, {
    text: "Why does the method need a warm-up phase?",
  });
  assert.equal(consumeChatDraft(itemID, sessionId, admitted.revision), true);
  // The pane re-renders and records the open PDF; the reader changes length.
  updateChatDraft(itemID, sessionId, {
    context: { attachmentID: 12, origin: "pane-open" },
  });
  updateChatDraft(itemID, sessionId, { responseLength: "short" });
  assert.equal(restoreChatDraft(itemID, sessionId, admitted), true);
  const restored = getChatDraft(itemID, sessionId);
  assert.equal(restored.text, "Why does the method need a warm-up phase?");
  assert.equal(restored.responseLength, "short");

  // Typing a next question still wins over the restore.
  const second = getChatDraft(itemID, sessionId);
  assert.equal(consumeChatDraft(itemID, sessionId, second.revision), true);
  updateChatDraft(itemID, sessionId, { text: "A new question" });
  assert.equal(restoreChatDraft(itemID, sessionId, second), false);
});
