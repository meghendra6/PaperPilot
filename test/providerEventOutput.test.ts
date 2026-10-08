import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseClaudeOutput } from "../src/modules/claude/outputParser";
import { parseCodexOutput } from "../src/modules/codex/outputParser";

const jsonl = (events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join("\n");

test("Claude event output captures real session and final answer without tool/diagnostic text", () => {
  const parsed = parseClaudeOutput(
    jsonl([
      { type: "system", subtype: "init", session_id: "claude-session-123" },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "PRIVATE TOOL OUTPUT" }],
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "partial" },
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", input: "PRIVATE TOOL INPUT" },
            { type: "text", text: "Final answer" },
          ],
        },
      },
      {
        type: "result",
        result: "Final answer",
        session_id: "claude-session-123",
        is_error: false,
      },
    ]),
  );
  assert.equal(parsed.text, "Final answer");
  assert.equal(parsed.sessionID, "claude-session-123");
  assert.equal(parsed.structuredOutput, true);
});

test("Claude partial text stays separate from malformed trailing events and error result", () => {
  const parsed = parseClaudeOutput(
    jsonl([
      { type: "system", session_id: "claude-session-123" },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "safe partial" },
        },
      },
      { type: "result", is_error: true, result: "auth diagnostic" },
    ]) + '\n{"type":"stream_event"',
  );
  assert.equal(parsed.text, "safe partial");
  assert.equal(parsed.errorText, "auth diagnostic");
  assert.equal(parsed.failed, true);
});

test("Codex parses source events rather than treating diagnostics as assistant output", () => {
  const parsed = parseCodexOutput(
    jsonl([
      { type: "thread.started", thread_id: "codex-session-123" },
      { type: "error", message: "credential diagnostic" },
      {
        type: "item.completed",
        item: { type: "agent_message", text: "Answer" },
      },
    ]),
  );
  assert.equal(parsed.text, "Answer");
  assert.equal(parsed.errorText, "credential diagnostic");
  assert.equal(parsed.sessionID, "codex-session-123");
});

test("plain CLI fallback answers remain readable without inventing session identity", () => {
  const result = parseClaudeOutput("Plain answer");
  assert.equal(result.text, "Plain answer");
  assert.equal(result.sessionID, undefined);
  assert.equal(result.structuredOutput, false);
});

test("Codex final structured answer replaces commentary and ignores user role snapshots", () => {
  const answer = JSON.stringify({
    paperpilotChatVersion: 1,
    answerMarkdown: "Final",
    citationCandidates: [],
  });
  const parsed = parseCodexOutput(
    jsonl([
      {
        type: "item.completed",
        item: { type: "agent_message", text: "Reading sources…" },
      },
      { type: "item.completed", item: { type: "agent_message", text: answer } },
      {
        type: "item.completed",
        item: { type: "message", role: "user", text: "private input" },
      },
      { type: "turn.completed" },
    ]),
  );
  assert.equal(parsed.text, answer);
  assert.equal(parsed.failed, false);
});

test("native terminal failures remain failures even with partial assistant content", () => {
  assert.equal(
    parseCodexOutput(
      jsonl([{ type: "turn.failed", error: { message: "failed" } }]),
    ).failed,
    true,
  );
  assert.equal(
    parseClaudeOutput(
      jsonl([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Partial" }] },
        },
        { type: "result", is_error: true, result: "failed" },
      ]),
    ).failed,
    true,
  );
});
