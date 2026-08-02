import * as assert from "node:assert/strict";
import { test } from "node:test";
import { finishRunAfterCleanup } from "../src/modules/ai/runCompletion";

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
      finalize: () => {
        events.push("finalized");
      },
    }),
    /persistence failure/,
  );

  assert.deepEqual(events, ["cleaned", "finalized"]);
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
