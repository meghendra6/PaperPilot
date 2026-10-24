import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as workspace from "../src/modules/ai/workspaceRun";
import * as ownership from "../src/modules/researchWorkspace/persistence/projectWorkspaceCleanup";
import * as automaticCleanup from "../src/modules/workspace/cleanup";
import { runResearchWorkspaceAnalysis } from "../src/modules/researchWorkspace/analysisRunner";

for (const failure of ["exit-read", "launch-ack"] as const) {
  test(`project ${failure} failure keeps process evidence until stop confirmation`, async (t) => {
    const runtime = globalThis as { addon?: unknown };
    const previous = runtime.addon;
    runtime.addon = { data: {} };
    t.after(() => {
      runtime.addon = previous;
    });
    let stopped = 0;
    let confirmed = 0;
    let removed = 0;
    const cleanup = {
      run: (_id: string, action: () => Promise<unknown>) => action(),
      stopProcess: async () => {
        stopped++;
        throw new Error("stop not confirmed");
      },
      confirmStopped: async () => {
        confirmed++;
      },
    } as unknown as ownership.ResearchWorkspaceProjectWorkspaceCleanup;
    t.mock.method(ownership, "projectWorkspaceCleanup", () => cleanup);
    t.mock.method(automaticCleanup, "cleanupWorkspaceIfEnabled", async () => {
      removed++;
      return true;
    });
    t.mock.method(
      workspace,
      "startWorkspaceTextRun",
      async (params: Parameters<typeof workspace.startWorkspaceTextRun>[0]) => {
        assert.equal(params.preserveWorkspaceOnPreparationFailure, true);
        assert.equal(typeof params.stopWorkspaceProcess, "function");
        if (failure === "launch-ack")
          return {
            ok: false,
            workspacePath: "/tmp/jobs/1-analysis-owned",
            promptPreview: "",
            error: "launch failed",
          };
        return {
          ok: true,
          workspacePath: "/tmp/jobs/1-analysis-owned",
          promptPreview: "",
          outputPath: "/tmp/output",
          stderrPath: "/tmp/stderr",
          exitCodePath: "/tmp/exit",
          pidPath: "/tmp/pid",
          processId: "12345",
        };
      },
    );
    t.mock.method(workspace, "waitForWorkspaceTextRun", async () => ({
      progress: {
        rawOutput: "",
        diagnosticOutput: "read failed",
        parsedOutput: "",
        completed: true,
        exitCode: "file-read-error",
        processExitCode: "file-read-error",
      },
      text: "",
    }));
    await assert.rejects(
      runResearchWorkspaceAnalysis({
        projectID: "p",
        itemID: failure === "exit-read" ? 91 : 92,
        itemTitle: "Paper",
        purpose: "claims",
        prompt: "Question",
        executionSettings: {
          mode: "codex_cli",
          model: "synthetic",
          responseLanguage: "English",
        },
      }),
    );
    assert.equal(stopped, 1);
    assert.equal(confirmed, 0);
    assert.equal(removed, 0);
  });
}

test("deferred failed launch acknowledgement retains ownership until its stop succeeds", async (t) => {
  const runtime = globalThis as { addon?: unknown };
  const previous = runtime.addon;
  runtime.addon = { data: {} };
  const reservation = workspace.claimWorkspaceRunReservation("codex_cli", 93);
  assert.ok(reservation);
  t.after(() => {
    workspace.releaseWorkspaceRunReservation(93, reservation);
    runtime.addon = previous;
  });
  let resolve!: (value: workspace.FailedWorkspaceRun) => void;
  const preparation = new Promise<workspace.FailedWorkspaceRun>((done) => {
    resolve = done;
  });
  let deferred: Promise<void> | undefined;
  let stopped = 0;
  let confirmed = 0;
  const controller = new AbortController();
  const started = workspace.startWorkspaceTextRun({
    mode: "codex_cli",
    itemID: 93,
    reservationItemID: 93,
    reservationToken: reservation,
    title: "Paper",
    sessionId: "project",
    question: "Question",
    profile: "analysis",
    signal: controller.signal,
    prepareRun: () => preparation,
    preserveWorkspaceOnPreparationFailure: true,
    onDeferredCleanup: (pending) => {
      deferred = pending;
    },
    stopWorkspaceProcess: async () => {
      stopped++;
      throw new Error("unconfirmed late process");
    },
    onWorkspaceProcessStopped: async () => {
      confirmed++;
    },
  });
  controller.abort();
  await assert.rejects(started, /cancelled/);
  assert.ok(deferred);
  const rejected = assert.rejects(deferred, /unconfirmed late process/);
  resolve({
    ok: false,
    workspacePath: "/tmp/jobs/93-analysis-owned",
    promptPreview: "",
    error: "launch ack failed",
  });
  await rejected;
  assert.equal(stopped, 1);
  assert.equal(confirmed, 0);
});
