import * as assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  buildKillProcessTreeScript,
  finishRunAfterCleanup,
  settleLatePreparedRun,
  stopDetachedRunProcess,
} from "../src/modules/ai/runCompletion";
import {
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  markReaderRunFinished,
  markReaderRunStarted,
} from "../src/modules/ai/runPresentation";

const execFileAsync = promisify(execFile);

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

test("kill scripts verify the recorded pid is still alive before signaling", () => {
  const script = buildKillProcessTreeScript("4321");
  assert.match(
    script,
    /is_run_pid_alive "\$root_pid" \|\| return 0[\s\S]*signal_run_tree "\$root_pid" TERM/,
  );
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

test("process termination waits and escalates before releasing the recorded pid", () => {
  const script = buildKillProcessTreeScript("4321");
  assert.match(script, /pgrep -P "\$pid"/);
  assert.match(script, /signal_run_tree "\$child" "\$signal"/);
  assert.match(script, /kill -STOP "\$pid"/);
  assert.match(script, /kill -KILL "\$pid"/);
  assert.match(script, /terminate_run_tree 4321$/);
});

test(
  "process termination kills a TERM-ignoring process and its descendants",
  {
    skip:
      !existsSync("/bin/zsh") ||
      !existsSync("/usr/bin/pgrep") ||
      process.platform !== "darwin",
  },
  async () => {
    const child = spawn(
      "/bin/zsh",
      ["-lc", 'trap "" TERM; while true; do /bin/sleep 5; done'],
      { stdio: "ignore" },
    );
    assert.ok(child.pid);
    const childPid = child.pid;
    let descendants: number[] = [];

    try {
      for (let attempt = 0; attempt < 20 && !descendants.length; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const result = await execFileAsync("/usr/bin/pgrep", [
          "-P",
          String(childPid),
        ]).catch(() => ({ stdout: "" }));
        descendants = String(result.stdout || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number);
      }
      assert.ok(descendants.length > 0);

      await execFileAsync("/bin/zsh", [
        "-lc",
        buildKillProcessTreeScript(String(childPid)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([
          once(child, "exit"),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("recorded process did not exit")),
              1_000,
            ),
          ),
        ]);
      }

      for (const pid of [childPid, ...descendants]) {
        assert.throws(
          () => process.kill(pid, 0),
          (error: NodeJS.ErrnoException) => error.code === "ESRCH",
        );
      }
    } finally {
      for (const pid of [childPid, ...descendants]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already stopped by the helper.
        }
      }
    }
  },
);

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
      args: ["-lc", buildKillProcessTreeScript("1234")],
    },
  ]);
});

test("detached process cleanup surfaces executor failures", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Utilities: {
      Internal: {
        exec: async () => new Error("termination failed"),
      },
    },
  };

  try {
    await assert.rejects(stopDetachedRunProcess("1234"), /termination failed/);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("started process cleanup requires a valid pid", async () => {
  await assert.rejects(
    stopDetachedRunProcess(undefined, { requireProcessId: true }),
    /valid pid/i,
  );
  await assert.rejects(
    stopDetachedRunProcess("not-a-pid", { requireProcessId: true }),
    /valid pid/i,
  );
  await assert.rejects(
    stopDetachedRunProcess("0", { requireProcessId: true }),
    /valid pid/i,
  );
  await assert.rejects(
    stopDetachedRunProcess("1", { requireProcessId: true }),
    /valid pid/i,
  );
});

test("late preparation retains ownership when process termination fails", async () => {
  const events: string[] = [];
  const result = await settleLatePreparedRun({
    stop: () => {
      events.push("stop-failed");
      throw new Error("could not stop");
    },
    cleanup: () => {
      events.push("unsafe-cleanup");
    },
    settle: () => {
      events.push("unsafe-settle");
    },
    onStopFailure: () => {
      events.push("reported-stop-failure");
    },
  });

  assert.equal(result, "stop_failed");
  assert.deepEqual(events, ["stop-failed", "reported-stop-failure"]);
});

test("late preparation settles even when workspace cleanup fails", async () => {
  const events: string[] = [];
  const result = await settleLatePreparedRun({
    stop: () => {
      events.push("stopped");
    },
    cleanup: () => {
      events.push("cleanup-failed");
      throw new Error("could not clean");
    },
    settle: () => {
      events.push("settled");
    },
    onCleanupFailure: () => {
      events.push("reported-cleanup-failure");
    },
  });

  assert.equal(result, "settled");
  assert.deepEqual(events, [
    "stopped",
    "cleanup-failed",
    "reported-cleanup-failure",
    "settled",
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
