import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceRunProgress,
  claimChatEngineRequest,
  claimPendingEngineCompletion,
  claimReaderSessionTransition,
  claimRetryEngineRequest,
  clearPendingEngineCompletion,
  failRunProgress,
  getPendingEngineCompletion,
  hasLastEngineRequest,
  isReaderSessionTransitionActive,
  isRetryEngineRequestPending,
  isChatEngineRequestPending,
  isChatPreparationCancelled,
  requestChatPreparationCancellation,
  registerPendingEngineCompletion,
  rememberLastEngineRequest,
  recoverLatePreparedRunStopFailure,
  releaseReaderSessionTransition,
  releaseChatEngineRequest,
  releaseRetryEngineRequest,
  startRunProgress,
} from "../src/modules/ai/runLifecycle";
import { getRunProgressState } from "../src/modules/ai/runProgress";
import {
  getActiveReaderRunMode,
  markReaderRunFinished,
  markReaderRunStarted,
} from "../src/modules/ai/runPresentation";

test("cancelling request preparation retains admission until it settles and stays paper-scoped", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = { data: {} };
  try {
    const token = claimChatEngineRequest(61);
    assert.ok(token);
    assert.equal(requestChatPreparationCancellation(62), false);
    assert.equal(requestChatPreparationCancellation(61), true);
    assert.equal(isChatPreparationCancelled(61), true);
    assert.equal(isChatPreparationCancelled(62), false);
    assert.equal(isChatEngineRequestPending(61), true);
    assert.equal(claimChatEngineRequest(61), undefined);
    releaseChatEngineRequest(61, Symbol("stale"));
    assert.equal(isChatPreparationCancelled(61), true);
    releaseChatEngineRequest(61, token);
    assert.equal(isChatEngineRequestPending(61), false);
    assert.equal(isChatPreparationCancelled(61), false);
    const next = claimChatEngineRequest(61);
    assert.ok(next);
    assert.equal(isChatPreparationCancelled(61), false);
    releaseChatEngineRequest(61, next);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

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

test("late stop failure restores cancellation ownership for another attempt", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      runProgressStates: new Map(),
    },
  };
  const token = markReaderRunStarted(54, "codex_cli");

  try {
    startRunProgress(54, "codex_cli", token);
    registerPendingEngineCompletion(54, {
      mode: "codex_cli",
      token,
      retryable: true,
      terminalClaim: "cancel",
      terminalSettled: true,
    });
    advanceRunProgress(54, token, { type: "cancelled", canRetry: true });
    markReaderRunFinished(54, token);

    const state = recoverLatePreparedRunStopFailure({
      itemID: 54,
      engine: "codex_cli",
      token,
      processId: "9054",
      rawError: "termination executor failed",
    });

    assert.equal(state?.phase, "running");
    assert.equal(state?.processId, "9054");
    assert.match(state?.failure?.userMessage ?? "", /Try Cancel again/i);
    assert.equal(getActiveReaderRunMode(54), "codex_cli");
    assert.equal(getPendingEngineCompletion(54)?.terminalClaim, undefined);
    assert.equal(getPendingEngineCompletion(54)?.terminalSettled, false);
    assert.equal(getPendingEngineCompletion(54)?.preparationSettled, true);
    assert.equal(
      claimPendingEngineCompletion(54, token, "cancel")?.terminalClaim,
      "cancel",
    );
  } finally {
    markReaderRunFinished(54, token);
    clearPendingEngineCompletion(54, token);
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

    const chatToken = claimChatEngineRequest(53);
    assert.ok(chatToken);
    assert.equal(claimRetryEngineRequest(53), undefined);
    assert.equal(claimReaderSessionTransition(53), undefined);
    releaseChatEngineRequest(53, Symbol("stale"));
    assert.equal(claimRetryEngineRequest(53), undefined);
    releaseChatEngineRequest(53, chatToken);
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
