import { test } from "node:test";
import * as assert from "node:assert/strict";

import { stopGeminiRunSilently } from "../src/modules/gemini/stopRun";

test("stopGeminiRunSilently kills the active pid and clears run state and poller state", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const execCalls: Array<{ command: string; args: string[] }> = [];

  const interval = setInterval(() => undefined, 60_000);

  (globalThis as { addon?: unknown }).addon = {
    data: {
      geminiRunStates: new Map([[91, { processId: "5234" }]]),
      geminiRunPollers: new Map([[91, interval]]),
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        exec: async (command: string, args: string[]) => {
          execCalls.push({ command, args });
        },
      },
    },
  };

  try {
    await stopGeminiRunSilently({ itemID: 91 });

    assert.deepEqual(execCalls, [
      {
        command: "/bin/zsh",
        args: ["-lc", "kill 5234 >/dev/null 2>&1 || true"],
      },
    ]);
    assert.equal(
      (globalThis as {
        addon?: { data?: { geminiRunStates?: Map<number, unknown> } };
      }).addon?.data?.geminiRunStates?.has(91),
      false,
    );
    assert.equal(
      (globalThis as {
        addon?: { data?: { geminiRunPollers?: Map<number, unknown> } };
      }).addon?.data?.geminiRunPollers?.has(91),
      false,
    );
  } finally {
    clearInterval(interval);
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
