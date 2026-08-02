import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  claimWorkspaceRunReservation,
  extractWorkspaceRunText,
  getWorkspaceEngineActiveMessage,
  getWorkspaceEngineLabel,
  isWorkspaceRunReservedForItem,
  releaseWorkspaceRunReservation,
} from "../src/modules/ai/workspaceRun";
import {
  clearPendingEngineCompletion,
  registerPendingEngineCompletion,
} from "../src/modules/ai/runLifecycle";

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

test("workspace run text extraction uses parsed stdout without raw stderr fallback", () => {
  assert.equal(
    extractWorkspaceRunText("claude_code", {
      rawOutput: "Plain Claude answer",
      parsedOutput: "Plain Claude answer",
      exitCode: "0",
    }),
    "Plain Claude answer",
  );
  assert.equal(
    extractWorkspaceRunText("codex_cli", {
      rawOutput:
        '{"type":"item.completed","item":{"type":"agent_message","message":"Codex final answer"}}\n{"type":"reasoning","text":"hidden"}',
      parsedOutput: "Codex final answer",
      exitCode: "0",
    }),
    "Codex final answer",
  );
  assert.equal(
    extractWorkspaceRunText("claude_code", {
      rawOutput: "/Users/private/paper stderr marker",
      parsedOutput: "",
      exitCode: "1",
    }),
    "",
  );
  assert.equal(
    extractWorkspaceRunText("codex_cli", {
      rawOutput:
        '{"type":"error","message":"/Users/private/paper stderr marker"}',
      parsedOutput: "",
      exitCode: "1",
    }),
    "",
  );
});

test("workspace reservations block direct runs and pending controller preparation", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      codexRunStates: new Map(),
      codexRunPollers: new Map(),
      claudeRunStates: new Map(),
      claudeRunPollers: new Map(),
      geminiRunStates: new Map(),
      geminiRunPollers: new Map(),
    },
  };

  try {
    const reservation = claimWorkspaceRunReservation("codex_cli", 44);
    assert.ok(reservation);
    assert.equal(isWorkspaceRunReservedForItem(44), true);
    assert.equal(claimWorkspaceRunReservation("claude_code", 44), undefined);
    releaseWorkspaceRunReservation(44, Symbol("stale"));
    assert.equal(isWorkspaceRunReservedForItem(44), true);
    releaseWorkspaceRunReservation(44, reservation);

    const controllerToken = Symbol("controller-preparation");
    registerPendingEngineCompletion(44, {
      mode: "gemini_cli",
      token: controllerToken,
      retryable: false,
    });
    assert.equal(claimWorkspaceRunReservation("codex_cli", 44), undefined);
    clearPendingEngineCompletion(44, controllerToken);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
