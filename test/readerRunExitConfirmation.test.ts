import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as codexRunner from "../src/modules/codex/runner";
import * as claudeRunner from "../src/modules/claude/runner";
import * as chat from "../src/modules/components/ChatMessage";
import * as cleanup from "../src/modules/workspace/cleanup";
import * as completion from "../src/modules/ai/runCompletion";
import { handleCodexQuestion } from "../src/modules/codex/controller";
import { handleClaudeQuestion } from "../src/modules/claude/controller";
import { sessionHistoryService } from "../src/modules/session/sessionHistoryService";
import { getPendingEngineCompletion } from "../src/modules/ai/runLifecycle";
import {
  getRunProgressState,
  RUN_TIMEOUT_MS,
} from "../src/modules/ai/runProgress";
import { isReaderChatBusy } from "../src/modules/ai/readerBusy";
import { markReaderRunFinished } from "../src/modules/ai/runPresentation";

for (const mode of ["codex_cli", "claude_code"] as const) {
  for (const outcome of ["stopped", "stop-failed", "exited"] as const) {
    test(`${mode} confirms process exit before cleanup (${outcome})`, async (t) => {
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
      const globals = globalThis as any;
      const previous = { addon: globals.addon, Zotero: globals.Zotero };
      const itemID = 921;
      const data = {
        codexRunStates: new Map(),
        codexRunPollers: new Map(),
        claudeRunStates: new Map(),
        claudeRunPollers: new Map(),
      };
      globals.addon = { data };
      globals.Zotero = {
        Prefs: { get: () => undefined },
        getTempDirectory: () => ({ path: "/test-profile/tmp" }),
      };
      t.after(() => {
        const pending = getPendingEngineCompletion(itemID);
        pending?.cancelTimeout?.();
        if (pending) markReaderRunFinished(itemID, pending.token);
        globals.addon = previous.addon;
        globals.Zotero = previous.Zotero;
      });
      let poll!: () => Promise<void>;
      t.mock.method(
        globalThis,
        "setInterval",
        (callback: () => Promise<void>) => {
          poll = callback;
          return {} as ReturnType<typeof setInterval>;
        },
      );
      t.mock.method(globalThis, "clearInterval", () => undefined);
      t.mock.method(chat, "addMessage", () => undefined);
      const started = {
        ok: true as const,
        workspacePath: "/test-profile/tmp/owned-chat",
        promptPreview: "",
        outputPath: "/output",
        stderrPath: "/stderr",
        exitCodePath: "/exit",
        pidPath: "/pid",
        processId: "12345",
      };
      const progress = {
        rawOutput: "",
        diagnosticOutput: "The run exit-code file could not be read.",
        parsedOutput: "",
        resumeSessionId: undefined,
        structuredOutput: false,
        providerFailed: false,
        latestEventType: "file_read_error",
        completed: true,
        exitCode: outcome === "exited" ? "1" : "file-read-error",
      };
      if (mode === "codex_cli") {
        t.mock.method(
          codexRunner,
          "startCodexRunForQuestion",
          async () => started,
        );
        t.mock.method(
          codexRunner,
          "readCodexRunProgress",
          async () => progress,
        );
      } else {
        t.mock.method(
          claudeRunner,
          "startClaudeRunForQuestion",
          async () => started,
        );
        t.mock.method(
          claudeRunner,
          "readClaudeRunProgress",
          async () => progress,
        );
      }
      const events: string[] = [];
      let finishStop!: () => void;
      const stopPending = new Promise<void>((resolve) => {
        finishStop = resolve;
      });
      t.mock.method(
        completion,
        "stopDetachedRunProcess",
        async (pid?: string, options?: { requireProcessId?: boolean }) => {
          assert.equal(pid, started.processId);
          assert.equal(options?.requireProcessId, true);
          events.push("stop-requested");
          await stopPending;
          if (outcome === "stop-failed")
            throw new Error("termination unconfirmed");
          events.push("stop-confirmed");
        },
      );
      t.mock.method(sessionHistoryService, "persistAssistantTurn", async () => {
        events.push("persisted");
        return undefined;
      });
      t.mock.method(cleanup, "cleanupWorkspaceIfEnabled", async () => {
        events.push("cleaned");
        return true;
      });
      const params = {
        itemID,
        sessionId: "session",
        sessionTitle: "Paper",
        question: "Question",
        chatMessages: {} as HTMLElement,
        streamingIndicator: { style: {} } as HTMLElement,
        onComplete: () => {
          events.push("completed");
        },
      };
      if (mode === "codex_cli")
        await handleCodexQuestion({ ...params, useResume: false });
      else await handleClaudeQuestion(params);

      const finishing = poll();
      if (outcome !== "exited") {
        // Let the progress read settle, leaving process termination in flight.
        await Promise.resolve();
        assert.deepEqual(events, ["stop-requested"]);
        assert.equal(isReaderChatBusy(itemID), true);
        const states =
          mode === "codex_cli" ? data.codexRunStates : data.claudeRunStates;
        assert.equal(states.get(itemID)?.processId, started.processId);
        // Another poll cannot finish or clean while termination is unconfirmed.
        await poll();
        assert.deepEqual(events, ["stop-requested"]);
        if (outcome === "stop-failed") {
          // The watchdog loses its terminal claim while this stop is pending.
          t.mock.timers.tick(RUN_TIMEOUT_MS);
          await Promise.resolve();
          assert.deepEqual(events, ["stop-requested"]);
        }
      }
      finishStop();
      await finishing;

      if (outcome === "stop-failed") {
        assert.deepEqual(events, ["stop-requested"]);
        assert.equal(isReaderChatBusy(itemID), true);
        assert.equal(
          getPendingEngineCompletion(itemID)?.terminalClaim,
          undefined,
        );
        assert.match(
          getRunProgressState(itemID)?.failure?.userMessage || "",
          /could not be stopped/i,
        );
        const states =
          mode === "codex_cli" ? data.codexRunStates : data.claudeRunStates;
        assert.equal(states.get(itemID)?.processId, started.processId);
        // A subsequent incomplete marker must not leave the run without a deadline.
        progress.completed = false;
        progress.exitCode = "";
        await poll();
        t.mock.timers.tick(5_000);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(events, ["stop-requested", "stop-requested"]);
        assert.equal(isReaderChatBusy(itemID), true);
      } else {
        assert.deepEqual(events, [
          ...(outcome === "stopped"
            ? ["stop-requested", "stop-confirmed"]
            : []),
          "persisted",
          "cleaned",
          "completed",
        ]);
        assert.equal(isReaderChatBusy(itemID), false);
      }
    });
  }
}
