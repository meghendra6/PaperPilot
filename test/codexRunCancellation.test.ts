import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  clearCodexRunStateForItem,
  isCodexRunActiveForItem,
  setCodexRunStateForItem,
} from "../src/modules/codex/runState";
import { stopCodexRunSilently } from "../src/modules/codex/stopRun";
import { buildKillProcessTreeScript } from "../src/modules/ai/runCompletion";
import {
  isReaderRunTokenActive,
  markReaderRunStarted,
} from "../src/modules/ai/runPresentation";

test("stopCodexRunSilently kills the active pid and clears run state and poller state", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const execCalls: Array<{ command: string; args: string[] }> = [];
  let finishExec!: () => void;

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
          await new Promise<void>((resolve) => {
            finishExec = resolve;
          });
        },
      },
    },
  };

  try {
    setCodexRunStateForItem(77, {
      workspacePath: "/tmp/paperpilot/77",
      model: "gpt-5.6-terra",
      loginState: "ready",
      runStatus: "running",
      latestEventType: "spawned",
      processId: "4123",
    });

    const runToken = markReaderRunStarted(77, "codex_cli");
    const stopPromise = stopCodexRunSilently({ itemID: 77 });

    assert.equal(isReaderRunTokenActive(77, runToken), false);
    finishExec();
    await stopPromise;

    assert.deepEqual(execCalls, [
      {
        command: "/bin/zsh",
        args: ["-lc", buildKillProcessTreeScript("4123")],
      },
    ]);
    assert.equal(
      (
        globalThis as {
          addon?: { data?: { codexRunStates?: Map<number, unknown> } };
        }
      ).addon?.data?.codexRunStates?.has(77),
      false,
    );
    assert.equal(
      (
        globalThis as {
          addon?: { data?: { codexRunPollers?: Map<number, unknown> } };
        }
      ).addon?.data?.codexRunPollers?.has(77),
      false,
    );
  } finally {
    clearInterval(interval);
    clearCodexRunStateForItem(77);
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("isCodexRunActiveForItem reports active poller or running state", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const interval = setInterval(() => undefined, 60_000);

  (globalThis as { addon?: unknown }).addon = {
    data: {
      codexRunStates: new Map(),
      codexRunPollers: new Map(),
    },
  };

  try {
    assert.equal(isCodexRunActiveForItem(77), false);

    (
      globalThis as {
        addon?: { data?: { codexRunPollers?: Map<number, unknown> } };
      }
    ).addon?.data?.codexRunPollers?.set(77, interval);
    assert.equal(isCodexRunActiveForItem(77), true);

    (
      globalThis as {
        addon?: { data?: { codexRunPollers?: Map<number, unknown> } };
      }
    ).addon?.data?.codexRunPollers?.delete(77);
    setCodexRunStateForItem(77, {
      workspacePath: "/tmp/paperpilot/77",
      model: "gpt-5.6-terra",
      loginState: "ready",
      runStatus: "running",
      latestEventType: "spawned",
      processId: "4123",
    });
    assert.equal(isCodexRunActiveForItem(77), true);
  } finally {
    clearInterval(interval);
    clearCodexRunStateForItem(77);
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("stopCodexRunSilently clears terminal state without signaling its stale pid", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  let execCalled = false;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      codexRunStates: new Map([
        [
          78,
          {
            workspacePath: "/tmp/paperpilot/78",
            model: "gpt-5.6-sol",
            loginState: "ready",
            runStatus: "completed",
            latestEventType: "completed",
            processId: "4123",
          },
        ],
      ]),
      codexRunPollers: new Map(),
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        exec: async () => {
          execCalled = true;
        },
      },
    },
  };

  try {
    await stopCodexRunSilently({ itemID: 78 });
    assert.equal(execCalled, false);
    assert.equal(
      (
        globalThis as {
          addon?: { data?: { codexRunStates?: Map<number, unknown> } };
        }
      ).addon?.data?.codexRunStates?.has(78),
      false,
    );
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
