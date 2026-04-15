import { test } from "node:test";
import * as assert from "node:assert/strict";

import { isLikelySilentToolMessage } from "../src/modules/session/silentTurnFilter";
import type { MessageRecord } from "../src/modules/message/types";

function buildAssistant(text: string): MessageRecord {
  return {
    id: "msg-1",
    role: "assistant",
    text,
    createdAt: "2026-04-15T00:00:00.000Z",
    sourceMode: "codex_cli",
    status: "done",
  };
}

function buildUser(text: string): MessageRecord {
  return {
    id: "msg-1",
    role: "user",
    text,
    createdAt: "2026-04-15T00:00:00.000Z",
    sourceMode: "codex_cli",
    status: "done",
  };
}

test("plain prose assistant message is not flagged as silent tool output", () => {
  const record = buildAssistant(
    "The paper argues that joint optimization beats sequential tuning.",
  );
  assert.equal(isLikelySilentToolMessage(record), false);
});

test("bare mastery question JSON line is flagged", () => {
  const record = buildAssistant(
    '{"question":"why?","topic":"x","difficulty":"foundational"}',
  );
  assert.equal(isLikelySilentToolMessage(record), true);
});

test("reasoning prose followed by a JSON object line with mastery keys is flagged", () => {
  const record = buildAssistant(
    [
      "현재 열린 논문 기준으로 질문을 만들어야 하니 본문을 다시 확인하겠습니다.",
      '{"understood":false,"confidence":0.99,"evaluation":"답변이 부족합니다."}',
    ].join("\n"),
  );
  assert.equal(isLikelySilentToolMessage(record), true);
});

test("artifact card JSON with kind/summary keys is flagged", () => {
  const record = buildAssistant(
    '{"kind":"research-brief","summary":"Overview","sections":[]}',
  );
  assert.equal(isLikelySilentToolMessage(record), true);
});

test("markdown code-fenced JSON example is not flagged", () => {
  const record = buildAssistant(
    [
      "Here is what the response shape looks like:",
      "```json",
      '{"question":"sample"}',
      "```",
    ].join("\n"),
  );
  assert.equal(isLikelySilentToolMessage(record), false);
});

test("user message containing JSON-shaped text is never flagged", () => {
  const record = buildUser(
    '{"question":"can you answer this?","topic":"y","difficulty":"foundational"}',
  );
  assert.equal(isLikelySilentToolMessage(record), false);
});

test("assistant message with only the word ok is not flagged", () => {
  assert.equal(isLikelySilentToolMessage(buildAssistant("ok")), false);
});

test("assistant message whose JSON line lacks any tool key is not flagged", () => {
  const record = buildAssistant('{"unrelated":"value","other":42}');
  assert.equal(isLikelySilentToolMessage(record), false);
});
