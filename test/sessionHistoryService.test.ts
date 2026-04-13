import { test } from "node:test";
import * as assert from "node:assert/strict";

import { messageStore } from "../src/modules/message/messageStore";
import { sessionStore } from "../src/modules/session/sessionStore";
import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistoryFileOps,
  type SessionHistorySnapshot,
} from "../src/modules/session/historyTypes";
import { SessionHistoryRepository } from "../src/modules/session/sessionHistoryRepository";
import { SessionHistoryService } from "../src/modules/session/sessionHistoryService";
import type { ComprehensionCheckState } from "../src/modules/comprehensionCheck/types";

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
    return [...this.files.keys()].filter((filePath) =>
      filePath.startsWith(`${normalizedPrefix}/`) ||
      filePath.startsWith(`${normalizedPrefix}\\`),
    );
  }
}

function buildMasteryState(): ComprehensionCheckState {
  return {
    phase: "complete",
    running: false,
    status: "Complete",
    currentQuestion: "What tradeoff matters most?",
    rounds: [
      {
        question: "What tradeoff matters most?",
        userAnswer: "Storage complexity versus restore fidelity.",
        evaluation: "Accurate",
        understood: true,
        explanation: "The answer preserved the core design tradeoff.",
      },
    ],
    topics: [
      {
        topic: "Session restore fidelity",
        understood: true,
        confidence: 0.9,
      },
    ],
  };
}

function installGlobals(prefs: Record<string, unknown>) {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  const prefWrites = new Map<string, unknown>();

  (globalThis as { addon?: unknown }).addon = {
    data: {
      currentSessionId: undefined,
      modeOverrides: new Map<number, "gemini_cli" | "codex_cli">(),
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

  return { globals, fileOps, repository, service };
}

function buildSavedSnapshot(itemID: number): SessionHistorySnapshot {
  return {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    sessionId: `saved-${itemID}`,
    paperItemID: itemID,
    title: "Saved session",
    createdAt: "2026-04-14T09:30:00.000Z",
    updatedAt: "2026-04-14T09:45:00.000Z",
    lastMode: "gemini_cli",
    lastCodexSessionID: "codex-thread-1",
    lastGeminiSessionID: "gemini-thread-1",
    lastModel: {
      mode: "gemini_cli",
      model: "gemini-3.1-pro-preview",
    },
    messages: [
      {
        id: "message-1",
        role: "user",
        text: "Compare the storage options.",
        createdAt: "2026-04-14T09:31:00.000Z",
        sourceMode: "codex_cli",
        status: "done",
      },
      {
        id: "message-2",
        role: "assistant",
        text: "The hybrid index plus snapshot model is the smallest fit.",
        createdAt: "2026-04-14T09:32:00.000Z",
        sourceMode: "gemini_cli",
        status: "done",
      },
    ],
    paperArtifacts: {
      running: false,
      status: "Ready",
      cards: [
        {
          kind: "research-brief",
          title: "Research brief",
          summary: "Summary",
          sections: [],
          sourceLabel: "Grounded",
          updatedAt: "2026-04-14T09:35:00.000Z",
        },
      ],
    },
    relatedRecommendations: {
      running: false,
      status: "Recommended",
      groups: [
        {
          category: "Closest match",
          papers: [
            {
              title: "Persistent conversations",
              authors: ["A. Researcher"],
              relevanceScore: 0.91,
            },
          ],
        },
      ],
    },
    mastery: buildMasteryState(),
  };
}

test("SessionHistoryService keeps one transient draft session per paper and does not persist blanks", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const codexDraft = service.ensureDraftSession({
      itemID: 501,
      mode: "codex_cli",
    });
    const geminiDraft = service.ensureDraftSession({
      itemID: 501,
      mode: "gemini_cli",
    });

    assert.equal(geminiDraft.sessionId, codexDraft.sessionId);
    assert.equal(geminiDraft.mode, "gemini_cli");
    assert.equal(
      (globalThis as { addon?: { data?: { currentSessionId?: string } } }).addon
        ?.data?.currentSessionId,
      codexDraft.sessionId,
    );

    const persisted = await service.persistActiveSession({
      itemID: 501,
      paperTitle: "Session history design",
    });

    assert.equal(persisted, undefined);
    assert.deepEqual(await repository.listSessions(501), []);

    sessionStore.reset(501, "codex_cli");
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService persists the active session snapshot with mixed-mode transcript metadata", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 502,
      mode: "codex_cli",
    });

    messageStore.append(session.sessionId, {
      role: "user",
      text: " How should draft sessions be persisted? ",
      sourceMode: "codex_cli",
      status: "done",
    });
    messageStore.append(session.sessionId, {
      role: "assistant",
      text: "Persist them after the first meaningful event.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    sessionStore.update(502, "gemini_cli", undefined, (existing) => {
      existing.lastCodexSessionID = "codex-thread-2";
      existing.lastGeminiSessionID = "gemini-thread-2";
      existing.lastModel = {
        mode: "gemini_cli",
        model: "gemini-3.1-pro-preview",
      };
    });

    (
      globalThis as {
        addon?: {
          data?: {
            paperArtifactStates?: Map<number, unknown>;
            relatedRecommendationStates?: Map<number, unknown>;
            comprehensionCheckStates?: Map<number, unknown>;
          };
        };
      }
    ).addon?.data?.paperArtifactStates?.set(502, {
      running: false,
      status: "Ready",
      cards: [
        {
          kind: "research-brief",
          title: "Research brief",
          summary: "Summary",
          sections: [],
          sourceLabel: "Grounded",
          updatedAt: "2026-04-14T09:35:00.000Z",
        },
      ],
    });
    (
      globalThis as {
        addon?: {
          data?: {
            relatedRecommendationStates?: Map<number, unknown>;
          };
        };
      }
    ).addon?.data?.relatedRecommendationStates?.set(502, {
      running: false,
      status: "Recommended",
      groups: [
        {
          category: "Closest match",
          papers: [
            {
              title: "Persistent conversations",
              authors: ["A. Researcher"],
              relevanceScore: 0.91,
            },
          ],
        },
      ],
    });
    (
      globalThis as {
        addon?: {
          data?: {
            comprehensionCheckStates?: Map<number, unknown>;
          };
        };
      }
    ).addon?.data?.comprehensionCheckStates?.set(502, buildMasteryState());

    const persisted = await service.persistActiveSession({
      itemID: 502,
      paperTitle: "Session history design",
    });

    assert.ok(persisted);
    assert.equal(persisted?.title, "How should draft sessions be persisted");
    assert.equal(persisted?.lastMode, "gemini_cli");
    assert.deepEqual(persisted?.lastModel, {
      mode: "gemini_cli",
      model: "gemini-3.1-pro-preview",
    });
    assert.equal(persisted?.messages?.length, 2);
    assert.equal(persisted?.messages?.[0].sourceMode, "codex_cli");
    assert.equal(persisted?.messages?.[1].sourceMode, "gemini_cli");
    assert.deepEqual(persisted?.paperArtifacts, {
      running: false,
      status: "Ready",
      cards: [
        {
          kind: "research-brief",
          title: "Research brief",
          summary: "Summary",
          sections: [],
          sourceLabel: "Grounded",
          updatedAt: "2026-04-14T09:35:00.000Z",
        },
      ],
    });
    assert.deepEqual(persisted?.relatedRecommendations, {
      running: false,
      status: "Recommended",
      groups: [
        {
          category: "Closest match",
          papers: [
            {
              title: "Persistent conversations",
              authors: ["A. Researcher"],
              relevanceScore: 0.91,
            },
          ],
        },
      ],
    });
    assert.deepEqual(persisted?.mastery, buildMasteryState());

    const savedSnapshot = await repository.readSessionSnapshot(502, session.sessionId);
    assert.deepEqual(savedSnapshot, persisted);

    messageStore.clear(session.sessionId);
    sessionStore.reset(502, "codex_cli");
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService honors prompts-only persistence for snapshots", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: true,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 503,
      mode: "codex_cli",
    });
    messageStore.append(session.sessionId, {
      role: "user",
      text: "Keep only the prompts.",
      sourceMode: "codex_cli",
      status: "done",
    });
    messageStore.append(session.sessionId, {
      role: "assistant",
      text: "This response should not be persisted.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    sessionStore.update(503, "codex_cli", undefined, (existing) => {
      existing.lastModel = {
        mode: "codex_cli",
        model: "gpt-5-codex",
        reasoningEffort: "medium",
      };
    });
    (
      globalThis as {
        addon?: {
          data?: {
            paperArtifactStates?: Map<number, unknown>;
            relatedRecommendationStates?: Map<number, unknown>;
            comprehensionCheckStates?: Map<number, unknown>;
          };
        };
      }
    ).addon?.data?.paperArtifactStates?.set(503, {
      running: false,
      status: "Ready",
      cards: [{ id: "card-1" }],
    });
    (
      globalThis as {
        addon?: {
          data?: {
            relatedRecommendationStates?: Map<number, unknown>;
          };
        };
      }
    ).addon?.data?.relatedRecommendationStates?.set(503, {
      running: false,
      status: "Recommended",
      groups: [{ id: "group-1" }],
    });
    (
      globalThis as {
        addon?: {
          data?: {
            comprehensionCheckStates?: Map<number, unknown>;
          };
        };
      }
    ).addon?.data?.comprehensionCheckStates?.set(503, buildMasteryState());

    const persisted = await service.persistActiveSession({
      itemID: 503,
      paperTitle: "Prompt-only session",
    });

    assert.ok(persisted);
    assert.deepEqual(persisted?.messages, [
      {
        id: persisted?.messages?.[0].id,
        role: "user",
        text: "Keep only the prompts.",
        createdAt: persisted?.messages?.[0].createdAt,
        sourceMode: "codex_cli",
        status: "done",
      },
    ]);
    assert.equal(persisted?.paperArtifacts, undefined);
    assert.equal(persisted?.relatedRecommendations, undefined);
    assert.equal(persisted?.mastery, undefined);
    assert.deepEqual(persisted?.lastModel, {
      mode: "codex_cli",
      model: "gpt-5-codex",
      reasoningEffort: "medium",
    });

    const savedSnapshot = await repository.readSessionSnapshot(503, session.sessionId);
    assert.deepEqual(savedSnapshot, persisted);

    messageStore.clear(session.sessionId);
    sessionStore.reset(503, "codex_cli");
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService opens a saved snapshot into the in-memory stores", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const snapshot = buildSavedSnapshot(504);
    await repository.saveSessionSnapshot({
      paperItemID: 504,
      paperTitle: "Saved paper",
      snapshot,
    });

    const opened = await service.openSavedSession({
      itemID: 504,
      sessionId: snapshot.sessionId,
    });

    assert.ok(opened);
    assert.equal(opened?.sessionId, snapshot.sessionId);
    assert.equal(opened?.mode, "gemini_cli");
    assert.deepEqual(messageStore.recentRaw(snapshot.sessionId, 10), snapshot.messages);
    assert.deepEqual(
      (
        globalThis as {
          addon?: {
            data?: {
              paperArtifactStates?: Map<number, unknown>;
            };
          };
        }
      ).addon?.data?.paperArtifactStates?.get(504),
      snapshot.paperArtifacts,
    );
    assert.deepEqual(
      (
        globalThis as {
          addon?: {
            data?: {
              relatedRecommendationStates?: Map<number, unknown>;
            };
          };
        }
      ).addon?.data?.relatedRecommendationStates?.get(504),
      snapshot.relatedRecommendations,
    );
    assert.deepEqual(
      (
        globalThis as {
          addon?: {
            data?: {
              comprehensionCheckStates?: Map<number, unknown>;
            };
          };
        }
      ).addon?.data?.comprehensionCheckStates?.get(504),
      snapshot.mastery,
    );
    assert.equal(
      (
        globalThis as {
          addon?: {
            data?: {
              modeOverrides?: Map<number, string>;
              currentSessionId?: string;
            };
          };
        }
      ).addon?.data?.modeOverrides?.get(504),
      "gemini_cli",
    );
    assert.equal(
      (
        globalThis as {
          addon?: {
            data?: {
              currentSessionId?: string;
            };
          };
        }
      ).addon?.data?.currentSessionId,
      snapshot.sessionId,
    );
    assert.equal(globals.prefWrites.get("geminiDefaultModel"), "gemini-3.1-pro-preview");

    messageStore.clear(snapshot.sessionId);
    sessionStore.reset(504, "codex_cli");
  } finally {
    globals.restore();
  }
});
