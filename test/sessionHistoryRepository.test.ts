import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistoryFileOps,
} from "../src/modules/session/historyTypes";
import { resolveSessionHistoryPrefs } from "../src/modules/session/historyPrefs";
import { buildSessionTitle } from "../src/modules/session/sessionTitle";
import { SessionHistoryRepository } from "../src/modules/session/sessionHistoryRepository";

function withPrefs(
  prefs: Record<string, boolean>,
  fn: () => void | Promise<void>,
) {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Prefs: {
      get: (key: string) => {
        const prefKey = key.split(".").pop() || key;
        if (prefKey in prefs) {
          return prefs[prefKey];
        }
        return true;
      },
    },
  };

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
    });
}

class MemoryFileOps implements SessionHistoryFileOps {
  files = new Map<string, string>();
  directories = new Set<string>();

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
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
}

function buildSnapshot() {
  return {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    sessionId: "paper-42-session-a",
    paperItemID: 42,
    title: "Compare retrieval chunking",
    createdAt: "2026-04-14T00:10:00.000Z",
    updatedAt: "2026-04-14T00:19:00.000Z",
    lastMode: "codex_cli" as const,
    lastCodexSessionID: "codex-thread-id",
    lastGeminiSessionID: "gemini-thread-id",
    lastModel: {
      mode: "codex_cli" as const,
      model: "gpt-5-codex",
      reasoningEffort: "medium",
    },
    messages: [
      {
        id: "message-1",
        role: "user" as const,
        text: "How should we persist session history?",
        createdAt: "2026-04-14T00:10:00.000Z",
        sourceMode: "codex_cli" as const,
        status: "done" as const,
      },
      {
        id: "message-2",
        role: "assistant" as const,
        text: "Use a paper index plus session snapshots.",
        createdAt: "2026-04-14T00:11:00.000Z",
        sourceMode: "codex_cli" as const,
        status: "done" as const,
      },
    ],
    paperArtifacts: { cards: [{ id: "card-1" }] },
    relatedRecommendations: { groups: [{ id: "group-1" }] },
    mastery: { currentQuestion: "What is the main tradeoff?" },
  };
}

test("resolveSessionHistoryPrefs applies the documented precedence", async () => {
  await withPrefs(
    {
      saveDocumentSessions: false,
      privacyStoreLocalHistory: true,
      privacySavePromptsOnly: false,
      privacySaveResponses: true,
    },
    () => {
      assert.deepEqual(resolveSessionHistoryPrefs(), {
        mode: "disabled",
        persistHistory: false,
        persistAssistantMessages: false,
        persistAssistantDerivedState: false,
      });
    },
  );

  await withPrefs(
    {
      saveDocumentSessions: true,
      privacyStoreLocalHistory: false,
      privacySavePromptsOnly: false,
      privacySaveResponses: true,
    },
    () => {
      assert.deepEqual(resolveSessionHistoryPrefs(), {
        mode: "disabled",
        persistHistory: false,
        persistAssistantMessages: false,
        persistAssistantDerivedState: false,
      });
    },
  );

  await withPrefs(
    {
      saveDocumentSessions: true,
      privacyStoreLocalHistory: true,
      privacySavePromptsOnly: true,
      privacySaveResponses: true,
    },
    () => {
      assert.deepEqual(resolveSessionHistoryPrefs(), {
        mode: "prompts-only",
        persistHistory: true,
        persistAssistantMessages: false,
        persistAssistantDerivedState: false,
      });
    },
  );

  await withPrefs(
    {
      saveDocumentSessions: true,
      privacyStoreLocalHistory: true,
      privacySavePromptsOnly: false,
      privacySaveResponses: false,
    },
    () => {
      assert.deepEqual(resolveSessionHistoryPrefs(), {
        mode: "prompts-only",
        persistHistory: true,
        persistAssistantMessages: false,
        persistAssistantDerivedState: false,
      });
    },
  );

  await withPrefs(
    {
      saveDocumentSessions: true,
      privacyStoreLocalHistory: true,
      privacySavePromptsOnly: false,
      privacySaveResponses: true,
    },
    () => {
      assert.deepEqual(resolveSessionHistoryPrefs(), {
        mode: "full",
        persistHistory: true,
        persistAssistantMessages: true,
        persistAssistantDerivedState: true,
      });
    },
  );
});

test("buildSessionTitle prefers the first user question and falls back to time", () => {
  assert.equal(
    buildSessionTitle(
      "  Can you compare retrieval chunking and answer length?  ",
      new Date("2026-04-14T09:30:00.000Z"),
    ),
    "Can you compare retrieval chunking and answer length",
  );

  assert.equal(
    buildSessionTitle("", new Date("2026-04-14T09:30:00.000Z")),
    "Session 2026-04-14 09:30 UTC",
  );
});

test("SessionHistoryRepository persists the paper index and snapshot via file ops", async () => {
  const fileOps = new MemoryFileOps();
  const repo = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
  });
  const snapshot = buildSnapshot();

  assert.equal(repo.getPaperIndexPath(42), "/session-history/papers/42/index.json");
  assert.equal(
    repo.getSessionSnapshotPath(42, snapshot.sessionId),
    "/session-history/papers/42/sessions/paper-42-session-a.json",
  );

  await repo.saveSessionSnapshot({
    paperItemID: 42,
    paperTitle: "Attention Is All You Need",
    snapshot,
  });

  const storedSnapshot = await repo.readSessionSnapshot(42, snapshot.sessionId);
  assert.deepEqual(storedSnapshot, snapshot);

  const index = await repo.readPaperIndex(42);
  assert.deepEqual(index, {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    paperItemID: 42,
    paperTitle: "Attention Is All You Need",
    sessions: [
      {
        storageVersion: SESSION_HISTORY_STORAGE_VERSION,
        sessionId: snapshot.sessionId,
        title: snapshot.title,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        messageCount: 2,
        lastMode: "codex_cli",
        hasArtifacts: true,
        hasRecommendations: true,
        hasMasteryState: true,
      },
    ],
  });
});

test("SessionHistoryRepository deletes the snapshot and removes the index entry", async () => {
  const fileOps = new MemoryFileOps();
  const repo = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
  });
  const snapshot = buildSnapshot();

  await repo.saveSessionSnapshot({
    paperItemID: 42,
    paperTitle: "Attention Is All You Need",
    snapshot,
  });

  await repo.deleteSession(42, snapshot.sessionId);

  assert.equal(await repo.readSessionSnapshot(42, snapshot.sessionId), undefined);
  assert.deepEqual(await repo.listSessions(42), []);
});
