import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearPendingEngineCompletion,
  failRunProgress,
  getPendingEngineCompletion,
  hasLastEngineRequest,
  registerPendingEngineCompletion,
  rememberLastEngineRequest,
} from "../src/modules/ai/runLifecycle";
import {
  markReaderRunFinished,
  markReaderRunStarted,
} from "../src/modules/ai/runPresentation";

test("pending engine completion is item-scoped and token-aware", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      lastEngineRequests: new Map(),
      runProgressStates: new Map(),
    },
  };
  const token = markReaderRunStarted(51, "claude_code");

  try {
    registerPendingEngineCompletion(51, {
      mode: "claude_code",
      token,
      retryable: false,
      workspacePath: "/tmp/paper-51",
    });

    assert.equal(
      getPendingEngineCompletion(51)?.workspacePath,
      "/tmp/paper-51",
    );
    assert.equal(getPendingEngineCompletion(52), undefined);
    clearPendingEngineCompletion(51, Symbol("stale"));
    assert.equal(getPendingEngineCompletion(51)?.token, token);
    clearPendingEngineCompletion(51, token);
    assert.equal(getPendingEngineCompletion(51), undefined);
  } finally {
    markReaderRunFinished(51, token);
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("silent failure remains non-retryable even when a chat request exists", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      lastEngineRequests: new Map(),
      runProgressStates: new Map(),
    },
  };

  try {
    rememberLastEngineRequest(61, {
      mode: "gemini_cli",
      sessionId: "session-61",
      sessionTitle: "Paper 61",
      question: "What is the contribution?",
    });
    assert.equal(hasLastEngineRequest(61), true);
    const state = failRunProgress({
      itemID: 61,
      engine: "gemini_cli",
      rawError: "command not found",
      source: "spawn",
      canRetry: false,
    });
    assert.equal(state.failure?.kind, "executable_missing");
    assert.equal(state.canRetry, false);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
