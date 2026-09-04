import * as assert from "node:assert/strict";
import { test } from "node:test";
import { cancelActiveEngineRun } from "../src/modules/ai/runControl";
import { completeTimedOutRun } from "../src/modules/ai/runTimeout";
import {
  getPendingEngineCompletion,
  markPendingEnginePreparationSettled,
  registerPendingEngineCompletion,
  startRunProgress,
} from "../src/modules/ai/runLifecycle";
import { getRunProgressState } from "../src/modules/ai/runProgress";
import {
  isReaderRunTokenActive,
  markReaderRunFinished,
  markReaderRunStarted,
} from "../src/modules/ai/runPresentation";

test("preparing cancellation retains the item barrier until the runner settles", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      claudeRunPollers: new Map(),
      claudeRunStates: new Map(),
      pendingEngineCompletions: new Map(),
      runProgressStates: new Map(),
      lastEngineRequests: new Map(),
    },
  };
  const token = markReaderRunStarted(81, "claude_code");
  let completions = 0;

  try {
    startRunProgress(81, "claude_code", token);
    registerPendingEngineCompletion(81, {
      mode: "claude_code",
      token,
      retryable: true,
      onComplete: () => {
        completions += 1;
      },
    });

    assert.equal(await cancelActiveEngineRun(81), true);
    assert.equal(isReaderRunTokenActive(81, token), false);
    assert.equal(getRunProgressState(81)?.phase, "cancelled");
    assert.equal(getPendingEngineCompletion(81)?.token, token);
    assert.equal(getPendingEngineCompletion(81)?.terminalClaim, "cancel");
    assert.equal(getPendingEngineCompletion(81)?.terminalSettled, true);
    assert.equal(completions, 1);

    markPendingEnginePreparationSettled(81, token);
    assert.equal(getPendingEngineCompletion(81), undefined);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("cancellation keeps ownership and the pid when process death cannot be confirmed", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      claudeRunPollers: new Map([[82, { observer: "exit-code poller" }]]),
      claudeRunStates: new Map([[82, { processId: "6789" }]]),
      pendingEngineCompletions: new Map(),
      runProgressStates: new Map(),
      lastEngineRequests: new Map(),
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        exec: async () => new Error("termination executor failed"),
      },
    },
  };
  const token = markReaderRunStarted(82, "claude_code");
  let timeoutCancelled = false;

  try {
    startRunProgress(82, "claude_code", token);
    registerPendingEngineCompletion(82, {
      mode: "claude_code",
      token,
      retryable: true,
      cancelTimeout: () => {
        timeoutCancelled = true;
      },
    });

    assert.equal(await cancelActiveEngineRun(82), false);
    assert.equal(isReaderRunTokenActive(82, token), true);
    assert.equal(getPendingEngineCompletion(82)?.terminalClaim, undefined);
    assert.equal(getPendingEngineCompletion(82)?.terminalSettled, undefined);
    assert.equal(getRunProgressState(82)?.phase, "preparing");
    assert.equal(timeoutCancelled, false);
    assert.equal(
      (globalThis as any).addon.data.claudeRunPollers.has(82),
      true,
      "the exit-code observer must remain armed for a delayed process exit",
    );
    assert.match(
      getRunProgressState(82)?.failure?.rawError ?? "",
      /could not confirm process termination/i,
    );
    assert.equal(
      (
        globalThis as {
          addon?: { data?: { claudeRunStates?: Map<number, unknown> } };
        }
      ).addon?.data?.claudeRunStates?.has(82),
      true,
    );
  } finally {
    markReaderRunFinished(82, token);
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("timeout keeps ownership when process death cannot be confirmed", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      runProgressStates: new Map(),
      lastEngineRequests: new Map(),
    },
  };
  const token = markReaderRunStarted(83, "gemini_cli");
  let timeoutRearmed = 0;

  try {
    startRunProgress(83, "gemini_cli", token);
    registerPendingEngineCompletion(83, {
      mode: "gemini_cli",
      token,
      retryable: true,
      rearmTimeout: () => {
        timeoutRearmed += 1;
      },
    });

    await completeTimedOutRun({
      itemID: 83,
      sessionId: "session-83",
      sessionTitle: "Timeout paper",
      engine: "gemini_cli",
      engineLabel: "Gemini CLI",
      token,
      stop: () => {
        throw new Error("termination executor failed");
      },
    });

    assert.equal(isReaderRunTokenActive(83, token), true);
    assert.equal(getPendingEngineCompletion(83)?.terminalClaim, undefined);
    assert.equal(getPendingEngineCompletion(83)?.terminalSettled, undefined);
    assert.equal(getRunProgressState(83)?.phase, "preparing");
    assert.equal(timeoutRearmed, 1);
    assert.match(
      getRunProgressState(83)?.failure?.rawError ?? "",
      /could not confirm process termination after timeout/i,
    );
  } finally {
    markReaderRunFinished(83, token);
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
