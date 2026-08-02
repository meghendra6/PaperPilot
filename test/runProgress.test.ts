import * as assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRunFailure } from "../src/modules/ai/runFailure";
import {
  createRunProgressState,
  getRunProgressState,
  isRunTimedOut,
  RUN_TIMEOUT_MS,
  setRunProgressState,
  transitionRunProgress,
} from "../src/modules/ai/runProgress";
import { formatRunElapsed } from "../src/modules/ui/runProgressCard";
import { armRunTimeout } from "../src/modules/ai/runTimeout";

test("run progress follows preparing, running, finishing, and completed", () => {
  const preparing = createRunProgressState({
    itemID: 12,
    engine: "codex_cli",
    token: Symbol("run-12"),
    now: 100,
  });
  const running = transitionRunProgress(preparing, {
    type: "spawned",
    at: 200,
    processId: "42",
  });
  const finishing = transitionRunProgress(running, {
    type: "finishing",
    at: 300,
  });
  const completed = transitionRunProgress(finishing, {
    type: "completed",
    at: 400,
  });

  assert.deepEqual(
    [preparing.phase, running.phase, finishing.phase, completed.phase],
    ["preparing", "running", "finishing", "completed"],
  );
  assert.equal(running.processId, "42");
});

test("run progress records workspace failure and retry availability", () => {
  const preparing = createRunProgressState({
    itemID: 13,
    engine: "claude_code",
    token: Symbol("run-13"),
    now: 100,
  });
  const failure = classifyRunFailure({
    engine: "claude_code",
    rawError: "workspace denied",
    source: "workspace",
  });
  const failed = transitionRunProgress(preparing, {
    type: "failed",
    at: 200,
    failure,
    canRetry: true,
  });

  assert.equal(failed.phase, "failed");
  assert.equal(failed.failure?.kind, "workspace_error");
  assert.equal(failed.canRetry, true);
});

test("run timeout is absolute and terminal phases do not time out", () => {
  const preparing = createRunProgressState({
    itemID: 14,
    engine: "gemini_cli",
    token: Symbol("run-14"),
    now: 100,
  });
  assert.equal(isRunTimedOut(preparing, 100 + RUN_TIMEOUT_MS - 1), false);
  assert.equal(isRunTimedOut(preparing, 100 + RUN_TIMEOUT_MS), true);
  const completed = transitionRunProgress(preparing, {
    type: "completed",
    at: 200,
  });
  assert.equal(isRunTimedOut(completed, 100 + RUN_TIMEOUT_MS), false);
});

test("run progress formats elapsed time without negative values", () => {
  assert.equal(formatRunElapsed(1000, 1000), "0:00");
  assert.equal(formatRunElapsed(1000, 62_000), "1:01");
  assert.equal(formatRunElapsed(2000, 1000), "0:00");
});

test("run progress storage keeps paper items isolated", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: { runProgressStates: new Map() },
  };

  try {
    setRunProgressState(
      createRunProgressState({
        itemID: 21,
        engine: "codex_cli",
        token: Symbol("run-21"),
        now: 100,
      }),
    );
    setRunProgressState(
      createRunProgressState({
        itemID: 22,
        engine: "gemini_cli",
        token: Symbol("run-22"),
        now: 200,
      }),
    );

    assert.equal(getRunProgressState(21)?.engine, "codex_cli");
    assert.equal(getRunProgressState(22)?.engine, "gemini_cli");
    assert.equal(getRunProgressState(23), undefined);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("absolute timeout guard is scheduled from the preparing start time", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduledDelay = -1;
  let scheduledCallback: (() => void) | undefined;
  let timedOut = 0;
  let cleared = false;
  (globalThis as { addon?: unknown }).addon = {
    data: { runProgressStates: new Map() },
  };
  Date.now = () => 150;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    scheduledCallback = callback;
    scheduledDelay = delay;
    return 1;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((_timer: number) => {
    cleared = true;
  }) as unknown as typeof clearTimeout;

  try {
    setRunProgressState(
      createRunProgressState({
        itemID: 31,
        engine: "claude_code",
        token: Symbol("run-31"),
        now: 100,
      }),
    );
    const dispose = armRunTimeout({
      itemID: 31,
      onTimeout: () => {
        timedOut += 1;
      },
    });

    assert.equal(scheduledDelay, RUN_TIMEOUT_MS - 50);
    scheduledCallback?.();
    scheduledCallback?.();
    assert.equal(timedOut, 1);
    dispose();
    assert.equal(cleared, false);
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
