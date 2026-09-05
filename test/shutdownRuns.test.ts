import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectShutdownRuns,
  stopShutdownRunsBestEffort,
} from "../src/modules/ai/shutdownRuns";

test("shutdown collects states, pollers, pending completions, and presentations", () => {
  const runs = collectShutdownRuns(
    {
      codexRunStates: new Map([
        [1, { processId: "101", runStatus: "running" }],
      ]),
      claudeRunStates: new Map([[2, { processId: "202" }]]),
      geminiRunStates: new Map(),
      codexRunPollers: new Map([[1, {}]]),
      claudeRunPollers: new Map(),
      geminiRunPollers: new Map([[3, {}]]),
      pendingEngineCompletions: new Map([
        [2, { mode: "claude_code" as const }],
      ]),
    },
    [{ itemID: 4, mode: "gemini_cli" }],
  );

  assert.deepEqual(
    runs.map((run) => [run.itemID, run.mode, run.processId]),
    [
      [1, "codex_cli", "101"],
      [2, "claude_code", "202"],
      [3, "gemini_cli", undefined],
      [4, "gemini_cli", undefined],
    ],
  );
});

test("shutdown starts best-effort process termination without blocking", async () => {
  const stopped: string[] = [];
  const logged: string[] = [];
  const completion = stopShutdownRunsBestEffort({
    runs: [
      { itemID: 1, mode: "codex_cli", processId: "101" },
      { itemID: 2, mode: "claude_code", processId: "202" },
      { itemID: 3, mode: "gemini_cli" },
    ],
    stop: async (processId) => {
      stopped.push(String(processId));
      if (processId === "202") throw new Error("kill failed");
    },
    log: (...values) => logged.push(values.map(String).join(" ")),
  });

  await completion;
  assert.deepEqual(stopped, ["101", "202"]);
  assert.equal(
    logged.some((line) => /could not resolve a pid/.test(line)),
    true,
  );
  assert.equal(
    logged.some((line) => /kill failed/.test(line)),
    true,
  );
});
