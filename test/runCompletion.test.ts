import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishRunAfterCleanup,
  stopDetachedRunProcess,
} from "../src/modules/ai/runCompletion";
import {
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  markReaderRunFinished,
  markReaderRunStarted,
} from "../src/modules/ai/runPresentation";

test("run completion removes the old workspace before a nested completion starts", async () => {
  const events: string[] = [];

  await finishRunAfterCleanup({
    prepare: () => {
      events.push("persisted");
    },
    cleanup: () => {
      events.push("old-workspace-removed");
    },
    complete: () => {
      events.push("nested-run-started");
    },
    finalize: () => {
      events.push("presentation-finished");
    },
  });

  assert.deepEqual(events, [
    "persisted",
    "old-workspace-removed",
    "nested-run-started",
    "presentation-finished",
  ]);
});

test("run completion does not clean again after a nested callback throws", async () => {
  let cleanupCalls = 0;
  let finalized = false;

  await assert.rejects(
    finishRunAfterCleanup({
      prepare: () => undefined,
      cleanup: () => {
        cleanupCalls++;
      },
      complete: () => {
        throw new Error("nested failure");
      },
      finalize: () => {
        finalized = true;
      },
    }),
    /nested failure/,
  );

  assert.equal(cleanupCalls, 1);
  assert.equal(finalized, true);
});

test("run completion still cleans and finalizes when persistence fails", async () => {
  const events: string[] = [];

  await assert.rejects(
    finishRunAfterCleanup({
      prepare: () => {
        throw new Error("persistence failure");
      },
      cleanup: () => {
        events.push("cleaned");
      },
      complete: () => {
        events.push("not-called");
      },
      incomplete: () => {
        events.push("failed-callback");
      },
      finalize: () => {
        events.push("finalized");
      },
    }),
    /persistence failure/,
  );

  assert.deepEqual(events, ["cleaned", "failed-callback", "finalized"]);
});

test("run completion does not retry a failing cleanup", async () => {
  let cleanupCalls = 0;
  let finalized = false;

  await assert.rejects(
    finishRunAfterCleanup({
      prepare: () => undefined,
      cleanup: () => {
        cleanupCalls++;
        throw new Error("cleanup failure");
      },
      complete: () => undefined,
      finalize: () => {
        finalized = true;
      },
    }),
    /cleanup failure/,
  );

  assert.equal(cleanupCalls, 1);
  assert.equal(finalized, true);
});

test("run completion skips a stale terminal callback after cleanup", async () => {
  const events: string[] = [];

  await finishRunAfterCleanup({
    prepare: () => {
      events.push("persisted");
    },
    cleanup: () => {
      events.push("cleaned");
    },
    shouldComplete: () => false,
    complete: () => {
      events.push("stale-callback");
    },
    incomplete: () => {
      events.push("failure-callback");
    },
    finalize: () => {
      events.push("finalized");
    },
  });

  assert.deepEqual(events, ["persisted", "cleaned", "finalized"]);
});

test("run completion reports cleanup failure without starting the success callback", async () => {
  const events: string[] = [];

  await assert.rejects(
    finishRunAfterCleanup({
      prepare: () => {
        events.push("persisted");
      },
      cleanup: () => {
        events.push("cleanup-failed");
        throw new Error("cleanup failure");
      },
      complete: () => {
        events.push("success-callback");
      },
      incomplete: () => {
        events.push("failure-callback");
      },
      finalize: () => {
        events.push("finalized");
      },
    }),
    /cleanup failure/,
  );

  assert.deepEqual(events, [
    "persisted",
    "cleanup-failed",
    "failure-callback",
    "finalized",
  ]);
});

test("detached process cleanup only executes a numeric pid", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const calls: Array<{ command: string; args: string[] }> = [];
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        exec: async (command: string, args: string[]) => {
          calls.push({ command, args });
        },
      },
    },
  };

  try {
    await stopDetachedRunProcess("1234");
    await stopDetachedRunProcess("1234; touch /tmp/not-allowed");
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }

  assert.deepEqual(calls, [
    {
      command: "/bin/zsh",
      args: ["-lc", "kill 1234 >/dev/null 2>&1 || true"],
    },
  ]);
});

test("run completion keeps the parent guard available for an explicit nested handoff", async () => {
  const itemID = 9301;
  const parent = markReaderRunStarted(itemID, "codex_cli");
  let child: symbol | undefined;

  await finishRunAfterCleanup({
    prepare: () => undefined,
    cleanup: () => undefined,
    shouldComplete: () => isReaderRunTokenActive(itemID, parent),
    complete: () => {
      assert.equal(isReaderRunTokenActive(itemID, parent), true);
      child = markReaderRunStarted(itemID, "codex_cli");
    },
    finalize: () => markReaderRunFinished(itemID, parent),
  });

  assert.equal(getActiveReaderRunMode(itemID), "codex_cli");
  assert.ok(child);
  markReaderRunFinished(itemID, child);
  assert.equal(getActiveReaderRunMode(itemID), undefined);
});
