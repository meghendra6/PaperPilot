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
import {
  buildInitialCriticalReadState,
  completeCriticalReadStep,
  markCriticalReadStepRunning,
  startCriticalRead,
} from "../src/modules/criticalRead/workflow";
import { buildCriticalReadReportMarkdown } from "../src/modules/criticalRead/report";

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

function buildMasteryState(): ComprehensionCheckState {
  return {
    phase: "complete",
    running: false,
    status: "Complete",
    finalReport: "## Final report\n\nThe grounding boundary is preserved.",
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
      criticalReadStates: new Map(),
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
              candidateID: "persistent-conversations",
              title: "Persistent conversations",
              authors: ["A. Researcher"],
              relevanceScore: 0.91,
              url: "https://proceedings.example.org/persistent",
              publicationClass: "verified_main",
              evidenceConfidence: "high",
              publicationEvidence: [
                {
                  type: "official_proceedings",
                  sourceName: "Official proceedings",
                  url: "https://proceedings.example.org/persistent",
                  observedTitle: "Persistent conversations",
                  observedTrack: "Main Conference",
                  checkedAt: "2026-04-14T09:35:00.000Z",
                  supports: ["identity", "published", "main_track"],
                },
              ],
            },
          ],
        },
      ],
    },
    mastery: buildMasteryState(),
    criticalRead: startCriticalRead(buildInitialCriticalReadState()),
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
    let criticalRead = startCriticalRead(buildInitialCriticalReadState());
    criticalRead = markCriticalReadStepRunning(
      criticalRead,
      "Independent skim notes",
    );
    criticalRead = completeCriticalReadStep({
      state: criticalRead,
      output: {
        summary: "Caption-grounded synthesis",
        items: [],
        sourceLocators: ["Figure 1"],
        limitations: [],
      },
    });
    (
      globalThis as {
        addon?: {
          data?: { criticalReadStates?: Map<number, unknown> };
        };
      }
    ).addon?.data?.criticalReadStates?.set(502, criticalRead);

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
    assert.deepEqual(persisted?.criticalRead, criticalRead);

    const savedSnapshot = await repository.readSessionSnapshot(
      502,
      session.sessionId,
    );
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
        model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });

    const savedSnapshot = await repository.readSessionSnapshot(
      503,
      session.sessionId,
    );
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
    assert.deepEqual(
      messageStore.recentRaw(snapshot.sessionId, 10),
      snapshot.messages,
    );
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
    const restoredRecommendations = (
      globalThis as {
        addon?: {
          data?: {
            relatedRecommendationStates?: Map<number, any>;
          };
        };
      }
    ).addon?.data?.relatedRecommendationStates?.get(504);
    assert.deepEqual(restoredRecommendations?.groups, []);
    const restoredCriticalRead = (
      globalThis as {
        addon?: {
          data?: { criticalReadStates?: Map<number, any> };
        };
      }
    ).addon?.data?.criticalReadStates?.get(504);
    assert.equal(restoredCriticalRead?.phase, "active");
    assert.equal(restoredCriticalRead?.running, false);
    assert.equal(restoredCriticalRead?.currentStep, 1);
    assert.equal(restoredCriticalRead?.steps[0].status, "ready");
    assert.match(restoredCriticalRead?.status, /validated/i);
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
    assert.equal(globals.prefWrites.size, 0);

    messageStore.clear(snapshot.sessionId);
    sessionStore.reset(504, "codex_cli");
  } finally {
    globals.restore();
  }
});

test("snapshot migration reopens malformed Critical Read output and clears stale reports", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });
  try {
    const snapshot = buildSavedSnapshot(505) as any;
    snapshot.criticalRead = {
      ...startCriticalRead(buildInitialCriticalReadState()),
      phase: "complete",
      currentStep: 7,
      reportMarkdown: "# stale verified main claim",
      reportNoteItemID: 999,
      steps: buildInitialCriticalReadState().steps.map((step) => ({
        ...step,
        status: "complete",
        output: step.id === 3 ? undefined : { summary: "x" },
        discovery:
          step.id === 3
            ? {
                schemaVersion: 1,
                plan: {
                  concernSummary: "Concern",
                  primaryField: "Field",
                  adjacentFields: [],
                  venues: [],
                  queries: [],
                  scopeSummary: "Scope",
                },
                verifiedMain: [],
                otherPeerReviewed: [],
                noveltyRadar: [],
                excluded: [],
                limitations: [],
                parseWarnings: [],
                completedAt: "2026-08-13T00:00:00.000Z",
              }
            : undefined,
      })),
    };
    await repository.saveSessionSnapshot({
      paperItemID: 505,
      paperTitle: "Saved paper",
      snapshot,
    });
    await service.openSavedSession({
      itemID: 505,
      sessionId: snapshot.sessionId,
    });
    const restored = (globalThis as any).addon.data.criticalReadStates.get(505);
    assert.equal(restored.phase, "active");
    assert.equal(restored.steps[0].status, "ready");
    assert.equal(restored.steps[0].output, undefined);
    assert.equal(restored.reportMarkdown, undefined);
    assert.equal(restored.reportNoteItemID, undefined);
  } finally {
    globals.restore();
    sessionStore.reset(505);
  }
});

test("snapshot migration retains current live evidence and rebuilds a reviewer-aware report", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });
  try {
    const snapshot = buildSavedSnapshot(506) as any;
    const commonOutput = {
      summary: "Validated synthesis",
      items: ["Observed result"],
      sourceLocators: ["Section 1"],
      limitations: ["Fixture"],
      scanObservations: {
        abstractSignal: "A scoped claim",
        figureTableSignals: ["A visible trend"],
        openQuestions: ["External validity"],
      },
      researchQuestion: {
        question: "What works?",
        problem: "A problem",
        setting: "A setting",
        claimedGap: "A gap",
        readerComparison: "Aligned",
      },
      methodChecks: [
        "data_provenance",
        "data_splits",
        "baselines",
        "metrics",
        "controls",
        "assumptions_validity",
        "statistics",
        "reproducibility",
        "scope_alignment",
      ].map((areaCode) => ({
        areaCode,
        area: areaCode,
        status: "supported",
        finding: "Checked",
      })),
      methodComparison: {
        agreements: ["Aligned method concern"],
        differences: [],
        unresolved: [],
      },
      evidenceConclusion: {
        supports: ["Claim"],
        doesNotSupport: ["Universal claim"],
        strongestResult: "Result A",
        weakestResult: "Result B",
        confidence: "medium",
      },
      authorComparison: {
        authorConclusionStatus: "available",
        agreements: ["Core claim"],
        readerOmissions: ["Caveat"],
        strongerAuthorClaims: ["Generality"],
        authorCaveats: ["Scale"],
        interpretiveDifferences: ["Magnitude"],
      },
      provenance: [
        { source: "paper_claim", text: "The paper claims a result." },
        { source: "agent_inference", text: "The result may be narrow." },
      ],
      alternatives: [
        {
          explanation: "A confound",
          explainedResult: "The gain",
          challengedAssumption: "Stable workload",
          discriminatingExperiment: "Cross-workload ablation",
          addressedByPaper: "partly",
        },
      ],
      finalSynthesis: {
        strongestSupportedClaim: "Scoped improvement",
        keyResidualUncertainty: "Generality",
        nextReadingOrExperiment: "Replication",
      },
    };
    const discovery = JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        liveVerification: {
          verifierVersion: 2,
          verifiedAt: "2026-08-13T00:00:00.000Z",
        },
        plan: {
          concernSummary: "Concern",
          primaryField: "Machine learning",
          adjacentFields: ["Optimization"],
          venues: [
            {
              venueName: "ICLR",
              venueAcronym: "ICLR",
              fields: ["Machine learning"],
              judgment: "leading",
              confidence: "high",
              basis: "Selective archival venue with public proceedings.",
            },
          ],
          queries: [
            { query: "problem", family: "problem", rationale: "direct" },
            { query: "method", family: "method", rationale: "mechanism" },
            { query: "result", family: "evaluation", rationale: "evidence" },
          ],
          scopeSummary: "Bounded search.",
        },
        verifiedMain: [
          {
            candidateID: "paper",
            title: "Verified Prior Work",
            authors: ["Ada Author"],
            year: 2026,
            urls: ["https://openreview.net/forum?id=paper"],
            providerIDs: { openreview: "paper" },
            venueName: "ICLR",
            venueAcronym: "ICLR",
            track: "Main conference poster",
            publicationClass: "verified_main",
            publicationEvidence: [
              {
                type: "official_decision",
                sourceName: "openreview",
                url: "https://openreview.net/forum?id=paper",
                observedTitle: "Verified Prior Work",
                observedVenue: "ICLR",
                observedTrack: "Main conference poster",
                observedDecision: "Accepted",
                checkedAt: "2026-08-13T00:00:00.000Z",
                supports: [
                  "identity",
                  "published",
                  "accepted",
                  "main_track",
                  "reviews_available",
                ],
              },
            ],
            evidenceConfidence: "high",
            leadingVenueAssessment: {
              venueName: "ICLR",
              venueAcronym: "ICLR",
              fields: ["Machine learning"],
              judgment: "leading",
              confidence: "high",
              basis: "Selective archival venue with public proceedings.",
            },
            relationship: "direct",
            relevanceReason: "Same concern.",
            noveltyRelationship: "same_problem_different_method",
            reviewURL: "https://openreview.net/forum?id=paper",
            reviewInsight: {
              sourceURLs: ["https://openreview.net/forum?id=paper"],
              valuedStrengths: ["Clear analysis"],
              concerns: ["Narrow scope"],
              reviewerPriorities: ["Ablations"],
              disagreements: ["Magnitude"],
              limitations: [],
              generatedAt: "2026-08-13T00:00:00.000Z",
            },
          },
        ],
        otherPeerReviewed: [],
        noveltyRadar: [],
        excluded: [],
        limitations: [],
        parseWarnings: [],
        completedAt: "2026-08-13T00:00:00.000Z",
      }),
    );
    snapshot.criticalRead = {
      ...startCriticalRead(buildInitialCriticalReadState()),
      phase: "complete",
      currentStep: 7,
      reportMarkdown: "# serialized report must not be trusted",
      steps: buildInitialCriticalReadState().steps.map((step) => ({
        ...step,
        status: "complete",
        output: step.id === 3 ? undefined : commonOutput,
        discovery: step.id === 3 ? discovery : undefined,
      })),
    };
    await repository.saveSessionSnapshot({
      paperItemID: 506,
      paperTitle: "Saved paper",
      snapshot,
    });
    await service.openSavedSession({
      itemID: 506,
      sessionId: snapshot.sessionId,
    });
    const restored = (globalThis as any).addon.data.criticalReadStates.get(506);
    assert.equal(restored.phase, "complete");
    assert.equal(restored.steps[2].status, "complete");
    assert.equal(
      restored.steps[2].discovery.liveVerification.verifierVersion,
      2,
    );
    assert.equal(restored.reportMarkdown, undefined);
    const rebuilt = buildCriticalReadReportMarkdown({
      paperTitle: "Saved paper",
      state: restored,
    });
    assert.match(rebuilt, /Reviewer perspective/);
    assert.match(rebuilt, /Clear analysis/);
    assert.match(rebuilt, /https:\/\/openreview.net\/forum\?id=paper/);
    assert.doesNotMatch(rebuilt, /serialized report must not be trusted/);
  } finally {
    globals.restore();
    sessionStore.reset(506);
  }
});

test("snapshot migration rebuilds recommendation lane labels from trusted discovery", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });
  try {
    const snapshot = buildSavedSnapshot(507);
    const rawPaper = (snapshot.relatedRecommendations as any).groups[0]
      .papers[0];
    snapshot.relatedRecommendations = {
      running: false,
      status: "stale",
      groups: [
        {
          category: "Verified main-conference papers",
          papers: [{ ...rawPaper, publicationClass: "preprint_only" }],
        },
      ],
    };
    await repository.saveSessionSnapshot({
      paperItemID: 507,
      paperTitle: "Saved paper",
      snapshot,
    });
    await service.openSavedSession({
      itemID: 507,
      sessionId: snapshot.sessionId,
    });
    assert.deepEqual(
      (globalThis as any).addon.data.relatedRecommendationStates.get(507)
        .groups,
      [],
    );
  } finally {
    globals.restore();
    sessionStore.reset(507);
  }
});

test("SessionHistoryService.persistAssistantTurn with suppressMessage skips chat persistence on the active session", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 601,
      mode: "codex_cli",
    });

    // A normal user message exists already in the transcript.
    messageStore.append(session.sessionId, {
      role: "user",
      text: "Walk me through the paper.",
      sourceMode: "codex_cli",
      status: "done",
    });

    const result = await service.persistAssistantTurn({
      itemID: 601,
      sessionId: session.sessionId,
      mode: "codex_cli",
      paperTitle: "Suppressed turn paper",
      assistantText:
        '{"question":"silent","topic":"x","difficulty":"foundational"}',
      success: true,
      rawEvent: '{"type":"item.completed"}',
      resumeSessionId: "codex-thread-suppressed",
      suppressMessage: true,
    });

    // No new assistant message in the in-memory store.
    const stored = messageStore.listRaw(session.sessionId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].role, "user");

    // The snapshot returned reflects no assistant message either.
    assert.ok(result);
    assert.equal(result?.messages?.length, 1);
    assert.equal(result?.messages?.[0].role, "user");

    // Resume metadata must still be tracked on the in-memory session.
    const live = sessionStore.get(601);
    assert.equal(live?.lastCodexSessionID, "codex-thread-suppressed");

    // The persisted snapshot on disk also reflects no new assistant message.
    const saved = await repository.readSessionSnapshot(601, session.sessionId);
    assert.equal(saved?.messages?.length, 1);
    assert.equal(saved?.messages?.[0].role, "user");
    assert.equal(saved?.lastCodexSessionID, "codex-thread-suppressed");

    messageStore.clear(session.sessionId);
    sessionStore.reset(601, "codex_cli");
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService keeps raw failure diagnostics out of replayed message text", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    const session = service.ensureDraftSession({
      itemID: 603,
      mode: "claude_code",
    });
    const userMessage =
      "Claude Code executable could not be found. Check its path in Paper Pilot settings.";
    const rawError = "secret-local-stderr-marker: ENOENT /private/bin/claude";

    await service.persistAssistantTurn({
      itemID: 603,
      sessionId: session.sessionId,
      mode: "claude_code",
      paperTitle: "Failure replay paper",
      assistantText: userMessage,
      success: false,
      rawEvent: rawError,
    });

    const liveMessage = messageStore.listRaw(session.sessionId).at(-1);
    assert.equal(liveMessage?.text, userMessage);
    assert.equal(liveMessage?.text.includes(rawError), false);
    assert.equal(liveMessage?.rawEvent, rawError);

    const saved = await repository.readSessionSnapshot(603, session.sessionId);
    const savedMessage = saved?.messages?.at(-1);
    assert.equal(savedMessage?.text, userMessage);
    assert.equal(savedMessage?.text.includes(rawError), false);
    assert.equal(savedMessage?.rawEvent, rawError);

    messageStore.clear(session.sessionId);
    sessionStore.reset(603, "claude_code");
  } finally {
    globals.restore();
  }
});

test("SessionHistoryService.persistAssistantTurn with suppressMessage skips message push on the late-completion branch", async () => {
  const { globals, repository, service } = createService({
    saveDocumentSessions: true,
    privacyStoreLocalHistory: true,
    privacySavePromptsOnly: false,
    privacySaveResponses: true,
  });

  try {
    // Simulate a previously persisted snapshot that the user has since switched away from.
    const priorSession = service.ensureDraftSession({
      itemID: 602,
      mode: "gemini_cli",
    });
    const priorSessionId = priorSession.sessionId;

    messageStore.append(priorSessionId, {
      role: "user",
      text: "Original question.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    messageStore.append(priorSessionId, {
      role: "assistant",
      text: "Original response.",
      sourceMode: "gemini_cli",
      status: "done",
    });
    await service.persistActiveSession({
      itemID: 602,
      paperTitle: "Late completion paper",
    });

    // User starts a new draft -- the active session is now different.
    sessionStore.reset(602, "gemini_cli");
    // Directly set a session with a guaranteed-different ID to avoid
    // Date.now() collisions when both calls happen in the same millisecond.
    const newSessionId = `paper-602-gemini_cli-new-draft`;
    sessionStore.set({
      sessionId: newSessionId,
      itemID: 602,
      mode: "gemini_cli",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      threadTitle: "New draft",
    });
    const newDraft = sessionStore.get(602)!;
    assert.notEqual(newDraft.sessionId, priorSessionId);

    // A late silent completion arrives bound to the prior session.
    const result = await service.persistAssistantTurn({
      itemID: 602,
      sessionId: priorSessionId,
      mode: "gemini_cli",
      paperTitle: "Late completion paper",
      assistantText: '{"understood":true,"confidence":0.9,"evaluation":"ok"}',
      success: true,
      resumeSessionId: "gemini-thread-late",
      suppressMessage: true,
    });

    // The prior snapshot must not gain a new assistant message...
    assert.ok(result);
    assert.equal(result?.messages?.length, 2);
    assert.equal(
      result?.messages?.[result.messages.length - 1].text,
      "Original response.",
    );

    // ...but resume metadata on the persisted snapshot is updated.
    const saved = await repository.readSessionSnapshot(602, priorSessionId);
    assert.equal(saved?.messages?.length, 2);
    assert.equal(saved?.lastGeminiSessionID, "gemini-thread-late");

    messageStore.clear(priorSessionId);
    messageStore.clear(newDraft.sessionId);
    sessionStore.reset(602, "gemini_cli");
  } finally {
    globals.restore();
  }
});
