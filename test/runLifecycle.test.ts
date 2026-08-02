import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceRunProgress,
  claimPendingEngineCompletion,
  claimReaderSessionTransition,
  claimRetryEngineRequest,
  clearPendingEngineCompletion,
  failRunProgress,
  getPendingEngineCompletion,
  hasLastEngineRequest,
  isReaderSessionTransitionActive,
  isRetryEngineRequestPending,
  registerPendingEngineCompletion,
  rememberLastEngineRequest,
  releaseReaderSessionTransition,
  releaseRetryEngineRequest,
  startRunProgress,
} from "../src/modules/ai/runLifecycle";
import { getRunProgressState } from "../src/modules/ai/runProgress";
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

test("session transitions and Retry use item-scoped atomic claims", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = { data: {} };

  try {
    const sessionToken = claimReaderSessionTransition(53);
    assert.ok(sessionToken);
    assert.equal(isReaderSessionTransitionActive(53), true);
    assert.equal(claimReaderSessionTransition(53), undefined);
    releaseReaderSessionTransition(53, Symbol("stale"));
    assert.equal(isReaderSessionTransitionActive(53), true);
    releaseReaderSessionTransition(53, sessionToken);
    assert.equal(isReaderSessionTransitionActive(53), false);

    const retryToken = claimRetryEngineRequest(53);
    assert.ok(retryToken);
    assert.equal(isRetryEngineRequestPending(53), true);
    assert.equal(claimReaderSessionTransition(53), undefined);
    releaseRetryEngineRequest(53, Symbol("stale"));
    assert.equal(isRetryEngineRequestPending(53), true);
    releaseRetryEngineRequest(53, retryToken);
    assert.equal(isRetryEngineRequestPending(53), false);
  } finally {
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
    const token = Symbol("run-61");
    startRunProgress(61, "gemini_cli", token);
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
      token,
      rawError: "command not found",
      source: "spawn",
      canRetry: false,
    });
    assert.equal(state?.failure?.kind, "executable_missing");
    assert.equal(state?.canRetry, false);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("terminal completion can be claimed only once for a run token", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: { pendingEngineCompletions: new Map() },
  };
  const token = Symbol("run-71");

  try {
    registerPendingEngineCompletion(71, {
      mode: "codex_cli",
      token,
      retryable: true,
    });
    assert.equal(
      claimPendingEngineCompletion(71, token, "controller")?.terminalClaim,
      "controller",
    );
    assert.equal(claimPendingEngineCompletion(71, token, "timeout"), undefined);
    assert.equal(
      claimPendingEngineCompletion(71, Symbol("stale"), "cancel"),
      undefined,
    );
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("a parent finalizer cannot overwrite child-owned progress", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      runProgressStates: new Map(),
      lastEngineRequests: new Map(),
    },
  };
  const parent = Symbol("parent");
  const child = Symbol("child");

  try {
    startRunProgress(72, "claude_code", parent);
    registerPendingEngineCompletion(72, {
      mode: "claude_code",
      token: parent,
      retryable: false,
    });
    claimPendingEngineCompletion(72, parent, "controller");

    startRunProgress(72, "claude_code", child);
    registerPendingEngineCompletion(72, {
      mode: "claude_code",
      token: child,
      retryable: false,
    });
    advanceRunProgress(72, child, { type: "spawned", processId: "902" });

    assert.equal(
      advanceRunProgress(72, parent, { type: "completed" }),
      undefined,
    );
    assert.equal(getRunProgressState(72)?.token, child);
    assert.equal(getRunProgressState(72)?.phase, "running");
    assert.equal(getPendingEngineCompletion(72)?.token, child);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
