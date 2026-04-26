import { test } from "node:test";
import * as assert from "node:assert/strict";
import { build } from "esbuild";

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
  throwOnMissingRead = true;

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    if (!this.files.has(path)) {
      if (this.throwOnMissingRead) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return undefined;
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
    return [...this.files.keys()].filter(
      (filePath) =>
        filePath.startsWith(`${normalizedPrefix}/`) ||
        filePath.startsWith(`${normalizedPrefix}\\`),
    );
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
      model: "gpt-5.5",
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

  assert.equal(
    repo.getPaperIndexPath(42),
    "/session-history/papers/42/index.json",
  );
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

test("SessionHistoryRepository returns an empty index when index.json is missing", async () => {
  const fileOps = new MemoryFileOps();
  const repo = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
  });

  const index = await repo.readPaperIndex(42);

  assert.deepEqual(index, {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    paperItemID: 42,
    paperTitle: "",
    sessions: [],
  });
});

test("SessionHistoryRepository recovers valid snapshots when index.json is malformed", async () => {
  const fileOps = new MemoryFileOps();
  const repo = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
  });
  const firstSnapshot = buildSnapshot();
  const secondSnapshot = {
    ...buildSnapshot(),
    sessionId: "paper-42-session-b",
    title: "Follow-up session",
    updatedAt: "2026-04-14T00:29:00.000Z",
    createdAt: "2026-04-14T00:20:00.000Z",
    messages: [
      {
        id: "message-3",
        role: "user" as const,
        text: "What if the index is broken?",
        createdAt: "2026-04-14T00:20:00.000Z",
        sourceMode: "gemini_cli" as const,
        status: "done" as const,
      },
    ],
  };

  fileOps.files.set(repo.getPaperIndexPath(42), "{ not valid json");
  fileOps.files.set(
    repo.getSessionSnapshotPath(42, firstSnapshot.sessionId),
    JSON.stringify(firstSnapshot),
  );
  fileOps.files.set(
    repo.getSessionSnapshotPath(42, secondSnapshot.sessionId),
    JSON.stringify(secondSnapshot),
  );

  const index = await repo.readPaperIndex(42);
  assert.deepEqual(
    index.sessions.map((entry) => entry.sessionId),
    [secondSnapshot.sessionId, firstSnapshot.sessionId],
  );
  assert.equal(index.sessions[0].title, secondSnapshot.title);

  await repo.deleteSession(42, firstSnapshot.sessionId);
  assert.deepEqual(
    (await repo.listSessions(42)).map((entry) => entry.sessionId),
    [secondSnapshot.sessionId],
  );
});

test("SessionHistoryRepository prunes index rows whose snapshot is missing", async () => {
  const fileOps = new MemoryFileOps();
  const repo = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
  });
  const validSnapshot = buildSnapshot();
  const missingSnapshotId = "paper-42-session-missing";

  fileOps.files.set(
    repo.getPaperIndexPath(42),
    JSON.stringify(
      {
        storageVersion: SESSION_HISTORY_STORAGE_VERSION,
        paperItemID: 42,
        paperTitle: "Attention Is All You Need",
        sessions: [
          {
            storageVersion: SESSION_HISTORY_STORAGE_VERSION,
            sessionId: validSnapshot.sessionId,
            title: validSnapshot.title,
            createdAt: validSnapshot.createdAt,
            updatedAt: validSnapshot.updatedAt,
            messageCount: 2,
            lastMode: "codex_cli",
            hasArtifacts: true,
            hasRecommendations: true,
            hasMasteryState: true,
          },
          {
            storageVersion: SESSION_HISTORY_STORAGE_VERSION,
            sessionId: missingSnapshotId,
            title: "Dead session",
            createdAt: "2026-04-14T00:05:00.000Z",
            updatedAt: "2026-04-14T00:06:00.000Z",
            messageCount: 1,
            lastMode: "gemini_cli",
            hasArtifacts: false,
            hasRecommendations: false,
            hasMasteryState: false,
          },
        ],
      },
      null,
      2,
    ),
  );
  fileOps.files.set(
    repo.getSessionSnapshotPath(42, validSnapshot.sessionId),
    JSON.stringify(validSnapshot),
  );

  const index = await repo.readPaperIndex(42);
  assert.deepEqual(
    index.sessions.map((entry) => entry.sessionId),
    [validSnapshot.sessionId],
  );
  assert.deepEqual(await repo.listSessions(42), index.sessions);
});

test("SessionHistoryRepository prunes index rows whose snapshot is corrupt", async () => {
  const fileOps = new MemoryFileOps();
  const repo = new SessionHistoryRepository({
    rootDir: "/session-history",
    fileOps,
  });
  const validSnapshot = buildSnapshot();
  const corruptSnapshotId = "paper-42-session-corrupt";

  fileOps.files.set(
    repo.getPaperIndexPath(42),
    JSON.stringify(
      {
        storageVersion: SESSION_HISTORY_STORAGE_VERSION,
        paperItemID: 42,
        paperTitle: "Attention Is All You Need",
        sessions: [
          {
            storageVersion: SESSION_HISTORY_STORAGE_VERSION,
            sessionId: validSnapshot.sessionId,
            title: validSnapshot.title,
            createdAt: validSnapshot.createdAt,
            updatedAt: validSnapshot.updatedAt,
            messageCount: 2,
            lastMode: "codex_cli",
            hasArtifacts: true,
            hasRecommendations: true,
            hasMasteryState: true,
          },
          {
            storageVersion: SESSION_HISTORY_STORAGE_VERSION,
            sessionId: corruptSnapshotId,
            title: "Corrupt session",
            createdAt: "2026-04-14T00:05:00.000Z",
            updatedAt: "2026-04-14T00:06:00.000Z",
            messageCount: 1,
            lastMode: "gemini_cli",
            hasArtifacts: false,
            hasRecommendations: false,
            hasMasteryState: false,
          },
        ],
      },
      null,
      2,
    ),
  );
  fileOps.files.set(
    repo.getSessionSnapshotPath(42, validSnapshot.sessionId),
    JSON.stringify(validSnapshot),
  );
  fileOps.files.set(
    repo.getSessionSnapshotPath(42, corruptSnapshotId),
    "{ not valid json",
  );

  const index = await repo.readPaperIndex(42);
  assert.deepEqual(
    index.sessions.map((entry) => entry.sessionId),
    [validSnapshot.sessionId],
  );
  assert.deepEqual(await repo.listSessions(42), index.sessions);
});

test("SessionHistoryRepository uses platform-safe path joining", () => {
  const previousPathUtils = (globalThis as { PathUtils?: unknown }).PathUtils;
  (globalThis as { PathUtils?: unknown }).PathUtils = {
    join: (...parts: string[]) => parts.join("\\"),
  };

  try {
    const repo = new SessionHistoryRepository({
      rootDir: "C:\\session-history",
      fileOps: new MemoryFileOps(),
    });

    assert.equal(
      repo.getPaperIndexPath(42),
      "C:\\session-history\\papers\\42\\index.json",
    );
    assert.equal(
      repo.getSessionSnapshotPath(42, "paper-42-session-a"),
      "C:\\session-history\\papers\\42\\sessions\\paper-42-session-a.json",
    );
  } finally {
    (globalThis as { PathUtils?: unknown }).PathUtils = previousPathUtils;
  }
});

test("SessionHistoryRepository falls back to Windows separators without PathUtils", () => {
  const previousPathUtils = (globalThis as { PathUtils?: unknown }).PathUtils;
  delete (globalThis as { PathUtils?: unknown }).PathUtils;

  try {
    const repo = new SessionHistoryRepository({
      rootDir: "C:\\session-history",
      fileOps: new MemoryFileOps(),
    });

    assert.equal(
      repo.getPaperIndexPath(42),
      "C:\\session-history\\papers\\42\\index.json",
    );
    assert.equal(
      repo.getSessionSnapshotPath(42, "paper-42-session-a"),
      "C:\\session-history\\papers\\42\\sessions\\paper-42-session-a.json",
    );
  } finally {
    (globalThis as { PathUtils?: unknown }).PathUtils = previousPathUtils;
  }
});

test("SessionHistoryRepository bundles without Node builtin path imports", async () => {
  await assert.doesNotReject(async () => {
    await build({
      entryPoints: ["src/modules/session/sessionHistoryRepository.ts"],
      bundle: true,
      write: false,
      logLevel: "silent",
    });
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

  assert.equal(
    await repo.readSessionSnapshot(42, snapshot.sessionId),
    undefined,
  );
  assert.deepEqual(await repo.listSessions(42), []);
});
