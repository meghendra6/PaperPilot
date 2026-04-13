import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  clearCodexRunStateForItem,
  setCodexRunStateForItem,
} from "../src/modules/codex/runState";
import { stopCodexRunSilently } from "../src/modules/codex/stopRun";

test("stopCodexRunSilently kills the active pid and clears run state and poller state", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const execCalls: Array<{ command: string; args: string[] }> = [];

  const interval = setInterval(() => undefined, 60_000);

  (globalThis as { addon?: unknown }).addon = {
    data: {
      codexRunStates: new Map(),
      codexRunPollers: new Map([[77, interval]]),
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
    setCodexRunStateForItem(77, {
      workspacePath: "/tmp/paperpilot/77",
      model: "gpt-5-codex",
      loginState: "ready",
      runStatus: "running",
      latestEventType: "spawned",
      processId: "4123",
    });

    await stopCodexRunSilently({ itemID: 77 });

    assert.deepEqual(execCalls, [
      {
        command: "/bin/zsh",
        args: ["-lc", "kill 4123 >/dev/null 2>&1 || true"],
      },
    ]);
    assert.equal(
      (globalThis as {
        addon?: { data?: { codexRunStates?: Map<number, unknown> } };
      }).addon?.data?.codexRunStates?.has(77),
      false,
    );
    assert.equal(
      (globalThis as {
        addon?: { data?: { codexRunPollers?: Map<number, unknown> } };
      }).addon?.data?.codexRunPollers?.has(77),
      false,
    );
  } finally {
    clearInterval(interval);
    clearCodexRunStateForItem(77);
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
