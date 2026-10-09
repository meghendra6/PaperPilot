import * as assert from "node:assert/strict";
import { test } from "node:test";
import { describeNewSessionImpact } from "../src/modules/session/newSessionImpact";
import {
  buildInitialCriticalReadState,
  completeCriticalReadStep,
  markCriticalReadStepRunning,
  startCriticalRead,
} from "../src/modules/criticalRead/workflow";

function criticalReadAfterOneStep() {
  const started = startCriticalRead(buildInitialCriticalReadState());
  return completeCriticalReadStep({
    state: markCriticalReadStepRunning(started, "notes"),
    output: { summary: "s", items: [], sourceLocators: [], limitations: [] },
  });
}

test("a new session needs no confirmation without Critical Read or Mastery progress", () => {
  assert.equal(
    describeNewSessionImpact({
      criticalRead: buildInitialCriticalReadState(),
      mastery: { phase: "idle", rounds: [] },
      historyMode: "full",
    }),
    undefined,
  );
  assert.equal(
    describeNewSessionImpact({ historyMode: "disabled" }),
    undefined,
  );
});

test("full history says the work moves to Past sessions", () => {
  const impact = describeNewSessionImpact({
    criticalRead: criticalReadAfterOneStep(),
    mastery: { phase: "awaiting-answer", rounds: [{}, {}] },
    historyMode: "full",
  });
  assert.ok(impact);
  assert.equal(impact.title, "Start a new session?");
  assert.match(impact.message, /Critical Read \(1\/7 steps\)/);
  assert.match(impact.message, /Paper Mastery \(2 answered questions\)/);
  assert.match(impact.message, /move to Past sessions/);
  assert.doesNotMatch(impact.message, /lost/);
});

test("prompts-only and disabled history say the work is lost", () => {
  const started = startCriticalRead(buildInitialCriticalReadState());
  const promptsOnly = describeNewSessionImpact({
    criticalRead: started,
    historyMode: "prompts-only",
  });
  assert.match(promptsOnly!.message, /Critical Read \(started\)/);
  assert.match(promptsOnly!.message, /saves prompts only/);
  assert.match(promptsOnly!.message, /will be lost/);

  const disabled = describeNewSessionImpact({
    mastery: { phase: "complete", rounds: [{}], finalReport: "# Report" },
    historyMode: "disabled",
  });
  assert.match(disabled!.message, /Paper Mastery \(final report\)/);
  assert.match(disabled!.message, /Session history is off/);
  assert.match(disabled!.message, /will be lost/);
});

test("a complete Critical Read is described as a finished report", () => {
  const complete = {
    ...criticalReadAfterOneStep(),
    phase: "complete" as const,
  };
  assert.match(
    describeNewSessionImpact({ criticalRead: complete, historyMode: "full" })!
      .message,
    /Critical Read \(complete report\)/,
  );
});
