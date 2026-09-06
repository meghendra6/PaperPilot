import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  parseChatAnswer,
  buildChatAnswerInstructions,
} from "../src/modules/message/chatAnswer";
import { renderInlineMarkdown } from "../src/modules/components/markdownRenderer";
import { safePublicURL } from "../src/modules/message/publicLinks";
import { sanitizeAssistantText } from "../src/modules/message/assistantOutput";

const sourceID = "zotero:1:ITEM:PDF";
test("chat envelopes admit bounded source-linked candidates and preserve answer content", () => {
  const parsed = parseChatAnswer(
    JSON.stringify({
      paperpilotChatVersion: 1,
      answerMarkdown: "A result [[cite:a]].",
      citationCandidates: [
        { id: "a", sourceID, quote: "Exact quote", pageIndex: 0 },
        { id: "b", sourceID: "zotero:2:ITEM:PDF", quote: "Different library" },
        { id: "c", sourceID, quote: "Forged verification", verified: true },
        { id: "d", sourceID, quote: "x".repeat(4001) },
        { id: "a", sourceID, quote: "Duplicate" },
      ],
    }),
    { allowedSourceIDs: new Set([sourceID]) },
  );
  assert.equal(parsed.answerMarkdown, "A result [[cite:a]].");
  assert.deepEqual(parsed.citationCandidates, [
    { id: "a", sourceID, quote: "Exact quote", pageIndex: 0 },
  ]);
  assert.equal(parsed.malformed, true);
  assert.match(buildChatAnswerInstructions(), /paperpilotChatVersion/);
});
test("ordinary requested JSON and code are not mistaken for internal envelopes", () => {
  for (const text of [
    '{"summary":"example","question":"valid JSON answer"}',
    '```json\n{"answerMarkdown":"example"}\n```',
    "const citationCandidates = [];",
  ]) {
    assert.equal(parseChatAnswer(text).answerMarkdown, text);
    assert.equal(parseChatAnswer(text).envelope, false);
  }
});
test("malformed envelopes recover only complete answer strings and hide partial JSON", () => {
  assert.equal(parseChatAnswer("{", { partial: true }).answerMarkdown, "");
  assert.equal(
    parseChatAnswer('{"answerMarkdown":', { partial: true }).answerMarkdown,
    "",
  );
  // A malformed tail cannot grant navigation, even with a complete answer.
  const completeAnswer = JSON.stringify({
    paperpilotChatVersion: 1,
    answerMarkdown: 'Readable "quote"',
    citationCandidates: [],
  }).replace(/\[\]\}$/, "[");
  assert.equal(
    parseChatAnswer(completeAnswer).answerMarkdown,
    'Readable "quote"',
  );
  assert.deepEqual(parseChatAnswer(completeAnswer).citationCandidates, []);
  assert.equal(
    parseChatAnswer('{"paperpilotChatVersion":1,"answerMarkdown":"incomplete', {
      partial: true,
    }).answerMarkdown,
    "",
  );
});
test("URLs survive sanitization and safe rendering; code stays literal and privileged schemes never activate", () => {
  const text = "[Source](https://example.org/paper.md?q=a&x=b)";
  assert.equal(sanitizeAssistantText(text), text);
  assert.match(
    renderInlineMarkdown(text),
    /href="https:\/\/example.org\/paper.md\?q=a&amp;x=b"/,
  );
  assert.doesNotMatch(
    renderInlineMarkdown("`[literal](https://example.org)`"),
    /href=/,
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///Users/private/paper.pdf",
    "zotero://select/items/ABC",
    "https://127.0.0.1/admin",
    "https://user:secret@example.org",
  ]) {
    assert.equal(safePublicURL(url), undefined);
    assert.doesNotMatch(renderInlineMarkdown(`[bad](${url})`), /<a /);
  }
  assert.equal(safePublicURL("https://example.org"), "https://example.org/");
});
