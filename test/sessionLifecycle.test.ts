import { test } from "node:test";
import * as assert from "node:assert/strict";

import { messageStore } from "../src/modules/message/messageStore";
import type { EngineMode } from "../src/modules/ai/types";
import {
  SessionHistoryRepository,
} from "../src/modules/session/sessionHistoryRepository";
import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistoryFileOps,
  type SessionHistorySnapshot,
} from "../src/modules/session/historyTypes";
import { SessionHistoryService } from "../src/modules/session/sessionHistoryService";

class MemoryFileOps implements SessionHistoryFileOps {
  files = new Map<string, string>();
  directories = new Set<string>();

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return this.files.get(path);
  }

  async writeTextAtomic(path: string, contents: string) {
    this.files.set(path, contents);
  }

  async remove(path: string) {
    this.files.delete(path);
  }

  async exists(path: string) {
    return this.files.has(path) || this.directories.has(path);
  }

  async listDirectory(path: string) {
    const normalizedPrefix = path.replace(/\/+$/, "");
    return [...this.files.keys()].filter((filePath) =>
      filePath.startsWith(`${normalizedPrefix}/`) ||
      filePath.startsWith(`${normalizedPrefix}\\`),
    );
  }
}

function installGlobals(prefs: Record<string, unknown>) {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const prefWrites = new Map<string, unknown>();

  (globalThis as { addon?: unknown }).addon = {
    data: {
      currentSessionId: undefined,
      modeOverrides: new Map<number, EngineMode>(),
      paperArtifactStates: new Map(),
      relatedRecommendationStates: new Map(),
      comprehensionCheckStates: new Map(),
      recentCodexModels: [],
    },
  };

  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => {
        const prefKey = key.split(".").pop() || key;
        if (prefKey in prefs) {
          return prefs[prefKey];
        }
        return true;
      },
      set: (key: string, value: unknown) => {
        const prefKey = key.split(".").pop() || key;
        prefWrites.set(prefKey, value);
        return value;
      },
      clear: () => undefined,
    },
  };

  return {
    prefWrites,
    restore() {
      (globalThis as { addon?: unknown }).addon = previousAddon;
      (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
    },
  };
}

function createService(prefs: Record<string, unknown>) {
  const globals = installGlobals(prefs);
  const fileOps = new MemoryFileOps();
  const repository = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
    now: () => new Date("2026-04-14T09:30:00.000Z"),
  });
  const service = new SessionHistoryService({
    repository,
    now: () => new Date("2026-04-14T09:30:00.000Z"),
  });

  return { globals, repository, service };
}

function buildSnapshot(params: {
  itemID: number;
  sessionId: string;
  title: string;
  updatedAt: string;
  lastMode?: EngineMode;
}): SessionHistorySnapshot {
  return {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    sessionId: params.sessionId,
    paperItemID: params.itemID,
    title: params.title,
    createdAt: "2026-04-14T09:00:00.000Z",
    updatedAt: params.updatedAt,
    lastMode: params.lastMode ?? "codex_cli",
    messages: [
      {
        id: `${params.sessionId}-message-1`,
        role: "user",
        text: "What changed?",
        createdAt: "2026-04-14T09:01:00.000Z",
        sourceMode: params.lastMode ?? "codex_cli",
        status: "done",
      },
    ],
  };
}

test("SessionHistoryService exposes saved-session list and edit operations for the current paper", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    await repository.saveSessionSnapshot({
      paperItemID: 701,
      paperTitle: "Task 3 paper",
      snapshot: buildSnapshot({
        itemID: 701,
        sessionId: "session-older",
        title: "Older session",
        updatedAt: "2026-04-14T09:15:00.000Z",
      }),
    });
    await repository.saveSessionSnapshot({
      paperItemID: 701,
      paperTitle: "Task 3 paper",
      snapshot: buildSnapshot({
        itemID: 701,
        sessionId: "session-newer",
        title: "Newer session",
        updatedAt: "2026-04-14T09:25:00.000Z",
        lastMode: "gemini_cli",
      }),
    });

    const listed = await (service as any).listSavedSessions({ itemID: 701 });
    assert.deepEqual(
      listed.map((entry: { sessionId: string }) => entry.sessionId),
      ["session-newer", "session-older"],
    );

    await (service as any).renameSavedSession({
      itemID: 701,
      sessionId: "session-older",
      title: "Renamed session",
    });
    assert.equal(
      (await repository.readSessionSnapshot(701, "session-older"))?.title,
      "Renamed session",
    );

    await (service as any).deleteSavedSession({
      itemID: 701,
      sessionId: "session-newer",
    });
    assert.deepEqual(
      (await repository.listSessions(701)).map((entry) => entry.sessionId),
      ["session-older"],
    );

    await (service as any).deleteAllSavedSessions({ itemID: 701 });
    assert.deepEqual(await repository.listSessions(701), []);
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService preserves the current session on new draft and reopening a saved session continues the same session", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const initialSession = service.ensureDraftSession({
      itemID: 702,
      mode: "codex_cli",
      title: "Task 3 paper",
    });
    messageStore.append(initialSession.sessionId, {
      role: "user",
      text: "Keep this session when I start a new one.",
      sourceMode: "codex_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 702,
      paperTitle: "Task 3 paper",
    });

    const nextDraft = await (service as any).startNewSessionDraft({
      itemID: 702,
      mode: "gemini_cli",
      paperTitle: "Task 3 paper",
    });
    assert.notEqual(nextDraft.sessionId, initialSession.sessionId);
    assert.deepEqual(
      (await repository.listSessions(702)).map((entry) => entry.sessionId),
      [initialSession.sessionId],
    );

    const reopened = await service.openSavedSession({
      itemID: 702,
      sessionId: initialSession.sessionId,
    });
    assert.equal(reopened?.sessionId, initialSession.sessionId);

    messageStore.append(initialSession.sessionId, {
      role: "assistant",
      text: "The reopened session should keep appending here.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 702,
      paperTitle: "Task 3 paper",
    });

    const saved = await repository.readSessionSnapshot(
      702,
      initialSession.sessionId,
    );
    assert.ok(saved);
    assert.ok(saved.messages);
    assert.equal(saved.sessionId, initialSession.sessionId);
    assert.equal(saved.messages.length, 2);
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService keeps a renamed title after reopening and continuing the session", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 7021,
      mode: "codex_cli",
      title: "Task 3 paper",
    });
    messageStore.append(session.sessionId, {
      role: "user",
      text: "Original first question",
      sourceMode: "codex_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 7021,
      paperTitle: "Task 3 paper",
    });

    await service.renameSavedSession({
      itemID: 7021,
      sessionId: session.sessionId,
      title: "Renamed session",
    });
    await service.openSavedSession({
      itemID: 7021,
      sessionId: session.sessionId,
    });

    await service.persistUserMessage({
      itemID: 7021,
      mode: "gemini_cli",
      paperTitle: "Task 3 paper",
      text: "Follow-up after reopening",
    });

    const saved = await repository.readSessionSnapshot(7021, session.sessionId);
    assert.ok(saved);
    assert.equal(saved.title, "Renamed session");
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService keeps an explicit rename to the paper title after reopening and continuing the session", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 7022,
      mode: "codex_cli",
      title: "Task 3 paper",
    });
    messageStore.append(session.sessionId, {
      role: "user",
      text: "Original first question",
      sourceMode: "codex_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 7022,
      paperTitle: "Task 3 paper",
    });

    await service.renameSavedSession({
      itemID: 7022,
      sessionId: session.sessionId,
      title: "Task 3 paper",
    });
    await service.openSavedSession({
      itemID: 7022,
      sessionId: session.sessionId,
    });

    await service.persistUserMessage({
      itemID: 7022,
      mode: "gemini_cli",
      paperTitle: "Task 3 paper",
      text: "Follow-up after reopening",
    });

    const saved = await repository.readSessionSnapshot(7022, session.sessionId);
    assert.ok(saved);
    assert.equal(saved.title, "Task 3 paper");
  } finally {
    globals.restore();
  }
});

test("Session lifecycle persists immediately after a user message append", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 703,
      mode: "codex_cli",
      title: "Lifecycle paper",
    });

    await (service as any).persistUserMessage({
      itemID: 703,
      paperTitle: "Lifecycle paper",
      sessionId: session.sessionId,
      mode: "codex_cli",
      text: "Persist as soon as the user sends this.",
    });

    const saved = await repository.readSessionSnapshot(703, session.sessionId);
    assert.ok(saved);
    assert.ok(saved.messages);
    assert.equal(saved.messages.length, 1);
    assert.equal(saved.messages[0].role, "user");
    assert.equal(
      saved.messages[0].text,
      "Persist as soon as the user sends this.",
    );
  } finally {
    globals.restore();
  }
});

test("Session lifecycle persists completed and error assistant turns without writing provider prefs", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 704,
      mode: "codex_cli",
      title: "Lifecycle paper",
    });
    messageStore.append(session.sessionId, {
      role: "user",
      text: "Persist both assistant outcomes.",
      sourceMode: "codex_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 704,
      paperTitle: "Lifecycle paper",
    });

    await (service as any).persistAssistantTurn({
      itemID: 704,
      paperTitle: "Lifecycle paper",
      sessionId: session.sessionId,
      assistantText: "Codex finished with an error.",
      success: false,
      rawEvent: "stderr",
      mode: "codex_cli",
    });

    await (service as any).persistAssistantTurn({
      itemID: 704,
      paperTitle: "Lifecycle paper",
      sessionId: session.sessionId,
      assistantText: "Gemini completed successfully.",
      success: true,
      rawEvent: "stdout",
      mode: "gemini_cli",
      resumeSessionId: "gemini-thread-704",
    });

    const saved = await repository.readSessionSnapshot(704, session.sessionId);
    assert.ok(saved);
    assert.ok(saved.messages);
    assert.equal(saved.messages.length, 3);
    assert.deepEqual(
      saved.messages.map((message) => ({
        role: message.role,
        text: message.text,
        sourceMode: message.sourceMode,
        status: message.status,
      })),
      [
        {
          role: "user",
          text: "Persist both assistant outcomes.",
          sourceMode: "codex_cli",
          status: "done",
        },
        {
          role: "assistant",
          text: "Codex finished with an error.",
          sourceMode: "codex_cli",
          status: "error",
        },
        {
          role: "assistant",
          text: "Gemini completed successfully.",
          sourceMode: "gemini_cli",
          status: "done",
        },
      ],
    );
    assert.equal(saved.lastGeminiSessionID, "gemini-thread-704");
    assert.equal(globals.prefWrites.size, 0);
  } finally {
    globals.restore();
  }
});
