import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChatNoteHtml,
  buildChatNotePreview,
} from "../src/modules/note/chatNote";
import type { MessageRecord } from "../src/modules/message/types";

test("note preview and saved content retain question, answer, source and local citation status", () => {
  const message: MessageRecord = {
    id: "answer-id",
    role: "assistant",
    text: "An interpretation <script>alert(1)</script> [[cite:one]]",
    status: "done",
    sourceMode: "codex_cli",
    createdAt: "2026-09-07",
    provenance: { sessionId: "original-session", messageId: "original-answer" },
    citations: [
      {
        id: "one",
        sourceID: "zotero:2:PAPER:PDF",
        quote: "A locally located passage.",
        pageIndex: 2,
        sourceFingerprint: "fingerprint",
        status: "verified",
      },
    ],
  };
  const context = {
    sessionID: "branch-session",
    question: "What supports this claim?",
  };
  const preview = buildChatNotePreview(
    message,
    { title: "Paper title", libraryID: 2, sourceID: "zotero:2:PAPER:PDF" },
    context,
  );
  for (const expected of [
    "What supports this claim?",
    "An interpretation",
    "zotero:2:PAPER:PDF",
    "PDF location matched",
    "PDF page 3",
    "branch-session",
    "original-session",
    "answer-id",
    "original-answer",
    "not the claim's truth",
  ])
    assert.ok(preview.includes(expected), expected);
  const html = buildChatNoteHtml(message, "Paper title", context);
  assert.ok(html.includes("What supports this claim?"));
  assert.ok(html.includes("PDF location matched"));
  assert.ok(html.includes("original-session"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(html.includes("<script>"), false);
});
