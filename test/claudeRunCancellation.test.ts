import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  clearClaudeRunStateForItem,
  isClaudeRunActiveForItem,
  setClaudeRunStateForItem,
} from "../src/modules/claude/runState";
import { stopClaudeRunSilently } from "../src/modules/claude/stopRun";

test("stopClaudeRunSilently kills the active pid and clears run state and poller state", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const execCalls: Array<{ command: string; args: string[] }> = [];

  const interval = setInterval(() => undefined, 60_000);

  (globalThis as { addon?: unknown }).addon = {
    data: {
      claudeRunStates: new Map([[33, { processId: "6789" }]]),
      claudeRunPollers: new Map([[33, interval]]),
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
    await stopClaudeRunSilently({ itemID: 33 });

    assert.deepEqual(execCalls, [
      {
        command: "/bin/zsh",
        args: ["-lc", "kill 6789 >/dev/null 2>&1 || true"],
      },
    ]);
    assert.equal(
      (
        globalThis as {
          addon?: { data?: { claudeRunStates?: Map<number, unknown> } };
        }
      ).addon?.data?.claudeRunStates?.has(33),
      false,
    );
    assert.equal(
      (
        globalThis as {
          addon?: { data?: { claudeRunPollers?: Map<number, unknown> } };
        }
      ).addon?.data?.claudeRunPollers?.has(33),
      false,
    );
  } finally {
    clearInterval(interval);
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("isClaudeRunActiveForItem reports active poller or process state", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const interval = setInterval(() => undefined, 60_000);

  (globalThis as { addon?: unknown }).addon = {
    data: {
      claudeRunStates: new Map(),
      claudeRunPollers: new Map(),
    },
  };

  try {
    assert.equal(isClaudeRunActiveForItem(33), false);

    (
      globalThis as {
        addon?: { data?: { claudeRunPollers?: Map<number, unknown> } };
      }
    ).addon?.data?.claudeRunPollers?.set(33, interval);
    assert.equal(isClaudeRunActiveForItem(33), true);

    (
      globalThis as {
        addon?: { data?: { claudeRunPollers?: Map<number, unknown> } };
      }
    ).addon?.data?.claudeRunPollers?.delete(33);
    setClaudeRunStateForItem(33, { processId: "6789" });
    assert.equal(isClaudeRunActiveForItem(33), true);
  } finally {
    clearInterval(interval);
    clearClaudeRunStateForItem(33);
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
