import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  extractWorkspaceRunText,
  getWorkspaceEngineActiveMessage,
  getWorkspaceEngineLabel,
} from "../src/modules/ai/workspaceRun";

test("workspace run labels cover all configured engines", () => {
  assert.equal(getWorkspaceEngineLabel("codex_cli"), "Codex CLI");
  assert.equal(getWorkspaceEngineLabel("claude_code"), "Claude Code");
  assert.equal(getWorkspaceEngineLabel("gemini_cli"), "Gemini CLI");
});

test("workspace run active messages name the selected engine and task", () => {
  assert.match(
    getWorkspaceEngineActiveMessage(
      "claude_code",
      "related-paper recommendations",
    ),
    /Claude Code run is already active.*related-paper recommendations/i,
  );
});

test("workspace run text extraction preserves plain text and parses Codex JSONL output", () => {
  assert.equal(
    extractWorkspaceRunText("claude_code", {
      rawOutput: "Plain Claude answer",
      parsedOutput: "Plain Claude answer",
    }),
    "Plain Claude answer",
  );
  assert.equal(
    extractWorkspaceRunText("codex_cli", {
      rawOutput:
        '{"type":"item.completed","item":{"type":"agent_message","message":"Codex final answer"}}\n{"type":"reasoning","text":"hidden"}',
      parsedOutput: "",
    }),
    "Codex final answer",
  );
});
