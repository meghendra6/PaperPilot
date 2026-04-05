import { test } from "node:test";
import * as assert from "node:assert/strict";

import { sanitizeAssistantText } from "../src/modules/message/assistantOutput";

test("sanitizeAssistantText removes source-only labels and urls", () => {
  const sanitized = sanitizeAssistantText(
    "Sources:\n[paper](https://example.com/paper)\nhttps://example.com/full\nSummary paragraph.",
  );

  assert.equal(sanitized, "paper\n\nSummary paragraph.");
});

test("sanitizeAssistantText replaces internal workspace filenames with natural phrasing", () => {
  const sanitized = sanitizeAssistantText(
    "I checked paper.md, paper.json, paper.txt, selection.json, recent-turns.json, metadata.json, annotations.json, and CONTEXT_INDEX.md.",
  );

  assert.equal(
    sanitized,
    "I checked the paper, the paper structure, the paper, the current selection, our earlier chat context, the paper metadata, the annotations, and the workspace context.",
  );
});
