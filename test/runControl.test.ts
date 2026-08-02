import * as assert from "node:assert/strict";
import { test } from "node:test";
import { cancelActiveEngineRun } from "../src/modules/ai/runControl";
import {
  getPendingEngineCompletion,
  markPendingEnginePreparationSettled,
  registerPendingEngineCompletion,
  startRunProgress,
} from "../src/modules/ai/runLifecycle";
import { getRunProgressState } from "../src/modules/ai/runProgress";
import {
  isReaderRunTokenActive,
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
