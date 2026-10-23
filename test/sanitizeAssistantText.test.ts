import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  presentRunAnswer,
  sanitizeAssistantText,
} from "../src/modules/message/assistantOutput";

test("sanitizeAssistantText preserves requested public sources and URLs", () => {
  const sanitized = sanitizeAssistantText(
    "Sources:\n[paper](https://example.com/paper)\nhttps://example.com/full\nSummary paragraph.",
  );

  assert.equal(
    sanitized,
    "Sources:\n[paper](https://example.com/paper)\nhttps://example.com/full\nSummary paragraph.",
  );
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

test("sanitizeAssistantText preserves fenced and inline code", () => {
  const source = [
    "Use `run()` with  two arguments.",
    "```python",
    "def run():",
    "    return fetch(  value  )",
    "```",
  ].join("\n");

  assert.equal(sanitizeAssistantText(source), source);
});

test("sanitizeAssistantText preserves indented lists and Markdown tables", () => {
  const source = [
    "1. Parent",
    "   - nested item",
    "",
    "| Name  | Value |",
    "| :---- | ----: |",
    "| A     |  10   |",
  ].join("\n");

  assert.equal(sanitizeAssistantText(source), source);
});

test("sanitizeAssistantText preserves DOI text", () => {
  const source = "DOI: 10.1145/3290605.3300233";
  assert.equal(sanitizeAssistantText(source), source);
});

test("a private URL ending a JSON string does not take the closing quote", () => {
  const json =
    '{"summary":"Extensions can read local files via file:///etc/passwd","items":[]}';
  const sanitized = sanitizeAssistantText(json);
  assert.doesNotMatch(sanitized, /file:/);
  assert.deepEqual(JSON.parse(sanitized), {
    summary: "Extensions can read local files via ",
    items: [],
  });
});

test("structured workflow output reaches its parser verbatim", () => {
  const output =
    '{"quote":"We release prompt.txt and metadata.json with the benchmark."}';
  assert.equal(presentRunAnswer(output, "analysis"), output);
  assert.match(
    presentRunAnswer("See prompt.txt for details.", "chat"),
    /See the prompt for details\./,
  );
});
