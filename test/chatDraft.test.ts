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
