import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  claimWorkspaceRunReservation,
  extractWorkspaceRunText,
  getWorkspaceEngineActiveMessage,
  getWorkspaceEngineLabel,
  isWorkspaceRunReservedForItem,
  releaseWorkspaceRunReservation,
  startWorkspaceTextRun,
} from "../src/modules/ai/workspaceRun";
import {
  claimChatEngineRequest,
  claimReaderSessionTransition,
  claimRetryEngineRequest,
  clearPendingEngineCompletion,
  registerPendingEngineCompletion,
  releaseReaderSessionTransition,
  releaseChatEngineRequest,
  releaseRetryEngineRequest,
} from "../src/modules/ai/runLifecycle";
import {
  canResumeProviderSession,
  getRunWorkspaceTitle,
} from "../src/modules/ai/runProfile";

test("run profiles isolate hidden workflows from the visible chat session", () => {
  assert.equal(getRunWorkspaceTitle("Paper", "chat"), "Paper");
  assert.equal(
    getRunWorkspaceTitle("Paper", "analysis"),
    "Paper analysis workflow",
  );
  assert.equal(
    getRunWorkspaceTitle("Paper", "discovery"),
    "Paper discovery workflow",
  );
  assert.equal(canResumeProviderSession("chat"), true);
  assert.equal(canResumeProviderSession("analysis"), false);
  assert.equal(canResumeProviderSession("discovery"), false);
});

test("workspace run labels cover all configured engines", () => {
  assert.equal(getWorkspaceEngineLabel("codex_cli"), "Codex CLI");
  assert.equal(getWorkspaceEngineLabel("claude_code"), "Claude Code");
  assert.equal(getWorkspaceEngineLabel("gemini_cli"), "Gemini CLI");
});

test("workspace run active messages name the selected engine and task", () => {
  assert.match(
    getWorkspaceEngineActiveMessage(
      "claude_code",
      "related-paper recommendations",
    ),
    /Claude Code run is already active.*related-paper recommendations/i,
  );
});

test("workspace run text extraction uses parsed stdout without raw stderr fallback", () => {
  assert.equal(
    extractWorkspaceRunText("claude_code", {
      rawOutput: "Plain Claude answer",
      parsedOutput: "Plain Claude answer",
      exitCode: "0",
    }),
    "Plain Claude answer",
  );
  assert.equal(
    extractWorkspaceRunText("codex_cli", {
      rawOutput:
        '{"type":"item.completed","item":{"type":"agent_message","message":"Codex final answer"}}\n{"type":"reasoning","text":"hidden"}',
      parsedOutput: "Codex final answer",
      exitCode: "0",
    }),
    "Codex final answer",
  );
  assert.equal(
    extractWorkspaceRunText("claude_code", {
      rawOutput: "/Users/private/paper stderr marker",
      parsedOutput: "",
      exitCode: "1",
    }),
    "",
  );
  assert.equal(
    extractWorkspaceRunText("codex_cli", {
      rawOutput:
        '{"type":"error","message":"/Users/private/paper stderr marker"}',
      parsedOutput: "",
      exitCode: "1",
    }),
    "",
  );
});

test("workspace reservations block direct runs and pending controller preparation", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      codexRunStates: new Map(),
      codexRunPollers: new Map(),
      claudeRunStates: new Map(),
      claudeRunPollers: new Map(),
      geminiRunStates: new Map(),
      geminiRunPollers: new Map(),
    },
  };

  try {
    const reservation = claimWorkspaceRunReservation("codex_cli", 44);
    assert.ok(reservation);
    assert.equal(isWorkspaceRunReservedForItem(44), true);
    assert.equal(claimWorkspaceRunReservation("claude_code", 44), undefined);
    assert.equal(claimRetryEngineRequest(44), undefined);
    releaseWorkspaceRunReservation(44, Symbol("stale"));
    assert.equal(isWorkspaceRunReservedForItem(44), true);
    releaseWorkspaceRunReservation(44, reservation);

    const controllerToken = Symbol("controller-preparation");
    registerPendingEngineCompletion(44, {
      mode: "gemini_cli",
      token: controllerToken,
      retryable: false,
    });
    assert.equal(claimWorkspaceRunReservation("codex_cli", 44), undefined);
    clearPendingEngineCompletion(44, controllerToken);

    const retryToken = claimRetryEngineRequest(44);
    assert.ok(retryToken);
    assert.equal(claimWorkspaceRunReservation("codex_cli", 44), undefined);
    releaseRetryEngineRequest(44, retryToken);

    const sessionTransition = claimReaderSessionTransition(44);
    assert.ok(sessionTransition);
    assert.equal(claimWorkspaceRunReservation("codex_cli", 44), undefined);
    releaseReaderSessionTransition(44, sessionTransition);

    const chatToken = claimChatEngineRequest(44);
    assert.ok(chatToken);
    assert.equal(claimWorkspaceRunReservation("codex_cli", 44), undefined);
    releaseChatEngineRequest(44, chatToken);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("workspace preparation cancellation returns promptly and owns late cleanup", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { addon?: unknown }).addon = {
    data: {
      pendingEngineCompletions: new Map(),
      codexRunStates: new Map(),
      codexRunPollers: new Map(),
      claudeRunStates: new Map(),
      claudeRunPollers: new Map(),
      geminiRunStates: new Map(),
      geminiRunPollers: new Map(),
    },
  };
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: { get: () => false },
  };
  try {
    const token = claimWorkspaceRunReservation("codex_cli", 91)!;
    const controller = new AbortController();
    let resolvePreparation!: (value: any) => void;
    const preparation = new Promise<any>((resolve) => {
      resolvePreparation = resolve;
    });
    let deferredCleanup: Promise<void> | undefined;
    const started = startWorkspaceTextRun({
      mode: "codex_cli",
      itemID: 91,
      reservationItemID: 91,
      reservationToken: token,
      title: "Paper",
      sessionId: "session",
      question: "question",
      profile: "analysis",
      signal: controller.signal,
      deadline: Date.now() + 60_000,
      prepareRun: () => preparation,
      onDeferredCleanup: (cleanup) => {
        deferredCleanup = cleanup;
      },
    });
    controller.abort();
    await assert.rejects(started, /cancelled/i);
    assert.ok(deferredCleanup);
    resolvePreparation({
      ok: false,
      workspacePath: "/tmp/test",
      promptPreview: "",
      error: "late failure",
    });
    await deferredCleanup;
    releaseWorkspaceRunReservation(91, token);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
