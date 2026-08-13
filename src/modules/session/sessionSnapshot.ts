import type { ComprehensionCheckState } from "../comprehensionCheck/types";
import type { EngineMode } from "../ai/types";
import { messageStore } from "../message/messageStore";
import type { MessageRecord } from "../message/types";
import { resolveSessionHistoryPrefs } from "./historyPrefs";
import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistorySnapshot,
} from "./historyTypes";
import { buildSessionTitle } from "./sessionTitle";
import type { PaperSession } from "./types";
import { migrateDiscoveryResult } from "../discovery/parser";
import { buildInitialCriticalReadState } from "../criticalRead/workflow";
import { parseCriticalReadOutput } from "../criticalRead/parser";
import type {
  CriticalReadState,
  CriticalReadStepID,
} from "../criticalRead/types";
import { normalizeHttpURL } from "../discovery/normalize";

declare const addon: { data: AddonSessionData } | undefined;

type AddonSessionData = {
  currentSessionId?: string;
  modeOverrides?: Map<number, EngineMode>;
  paperArtifactStates?: Map<number, unknown>;
  relatedRecommendationStates?: Map<number, unknown>;
  comprehensionCheckStates?: Map<number, unknown>;
  criticalReadStates?: Map<number, unknown>;
};

type PersistedPaperArtifactState = {
  running: boolean;
  status: string;
  activeKind?: string;
  cards: unknown[];
};

type PersistedRecommendationState = {
  running: boolean;
  status: string;
  groups: unknown[];
};

function cloneValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function getAddonData() {
  const globalData = (
    globalThis as typeof globalThis & {
      addon?: { data: AddonSessionData };
    }
  ).addon?.data;
  const data =
    (typeof addon !== "undefined" ? addon?.data : undefined) || globalData;

  return (
    data || {
      currentSessionId: undefined,
      modeOverrides: undefined,
      paperArtifactStates: undefined,
      relatedRecommendationStates: undefined,
      comprehensionCheckStates: undefined,
      criticalReadStates: undefined,
    }
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasCards(value: unknown): value is PersistedPaperArtifactState {
  return (
    isPlainObject(value) &&
    Array.isArray(value.cards) &&
    value.cards.length > 0 &&
    value.running === false
  );
}

function hasGroups(value: unknown): value is PersistedRecommendationState {
  return (
    isPlainObject(value) &&
    Array.isArray(value.groups) &&
    value.groups.length > 0 &&
    value.running === false
  );
}

function migrateRecommendationState(value: unknown) {
  if (!isPlainObject(value) || !Array.isArray(value.groups)) return undefined;
  const discovery = migrateDiscoveryResult(value.discovery);
  const allowed = discovery
    ? new Map(
        [
          ...discovery.verifiedMain,
          ...discovery.otherPeerReviewed,
          ...discovery.noveltyRadar,
        ].map((paper) => [paper.candidateID, paper]),
      )
    : new Map();
  const groups = value.groups.flatMap((group) => {
    if (!isPlainObject(group) || !Array.isArray(group.papers)) return [];
    return [
      {
        category:
          typeof group.category === "string" ? group.category : "Related work",
        papers: group.papers.flatMap((paper) => {
          if (!isPlainObject(paper)) return [];
          const candidateID =
            typeof paper.candidateID === "string" ? paper.candidateID : "";
          const valid = allowed.get(candidateID);
          if (valid) {
            return [
              {
                ...cloneValue(paper),
                existingItemID: undefined,
                publicationClass: valid.publicationClass,
                publicationEvidence: cloneValue(valid.publicationEvidence),
                evidenceConfidence: valid.evidenceConfidence,
                reviewURL: valid.reviewURL,
                reviewInsight: valid.reviewInsight,
                url:
                  typeof paper.url === "string"
                    ? normalizeHttpURL(paper.url)
                    : undefined,
                urls: Array.isArray(paper.urls)
                  ? paper.urls
                      .map((url) =>
                        typeof url === "string"
                          ? normalizeHttpURL(url)
                          : undefined,
                      )
                      .filter(Boolean)
                  : undefined,
              },
            ];
          }
          const safeURL =
            typeof paper.url === "string"
              ? normalizeHttpURL(paper.url)
              : undefined;
          const safeURLs = Array.isArray(paper.urls)
            ? paper.urls
                .map((url) =>
                  typeof url === "string" ? normalizeHttpURL(url) : undefined,
                )
                .filter((url): url is string => Boolean(url))
            : [];
          if (!safeURL && !safeURLs.length && typeof paper.doi !== "string") {
            return [];
          }
          return [
            {
              ...cloneValue(paper),
              existingItemID: undefined,
              url: safeURL,
              urls: safeURLs,
              publicationClass: "unverified",
              publicationEvidence: [],
              evidenceConfidence: "none",
              reviewURL: undefined,
              reviewInsight: undefined,
            },
          ];
        }),
      },
    ];
  });
  return {
    ...cloneValue(value),
    running: false,
    status: typeof value.status === "string" ? value.status : "",
    groups,
    ...(discovery ? { discovery } : {}),
    reviewInsightRunningCandidateID: undefined,
  };
}

function isCompletedMasteryState(
  value: unknown,
): value is ComprehensionCheckState {
  return (
    isPlainObject(value) &&
    value.phase === "complete" &&
    value.running === false &&
    Array.isArray(value.rounds) &&
    Array.isArray(value.topics)
  );
}

function hasCriticalReadState(value: unknown) {
  return (
    isPlainObject(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.steps) &&
    (value.phase === "active" || value.phase === "complete")
  );
}

function migrateCriticalReadState(
  value: unknown,
): CriticalReadState | undefined {
  if (!hasCriticalReadState(value)) return undefined;
  const initial = buildInitialCriticalReadState();
  const source = cloneValue(value) as Record<string, unknown>;
  const sourceSteps = Array.isArray(source.steps) ? source.steps : [];
  const invalidSteps = new Set<CriticalReadStepID>();
  const steps = initial.steps.map((definition) => {
    const raw = sourceSteps.find(
      (entry) => isPlainObject(entry) && entry.id === definition.id,
    );
    if (!isPlainObject(raw)) return definition;
    let status = ["locked", "ready", "complete"].includes(String(raw.status))
      ? (raw.status as CriticalReadState["steps"][number]["status"])
      : "locked";
    const discovery =
      definition.id === 3 ? migrateDiscoveryResult(raw.discovery) : undefined;
    let output: CriticalReadState["steps"][number]["output"];
    if (definition.id !== 3 && status === "complete") {
      try {
        output = parseCriticalReadOutput(
          JSON.stringify(raw.output),
          definition.id,
        );
      } catch {
        status = "ready";
        invalidSteps.add(definition.id);
      }
    }
    if (definition.id === 3 && status === "complete") {
      // Only evidence reconstructed by this verifier generation can cross a
      // restart. Legacy/model-authored snapshots have no trusted marker and
      // must be checked live again.
      if (discovery?.liveVerification?.verifierVersion !== 1) {
        status = "ready";
        invalidSteps.add(3);
      }
    }
    return {
      ...definition,
      status,
      readerInput:
        typeof raw.readerInput === "string" ? raw.readerInput : undefined,
      output,
      discovery,
      completedAt:
        status === "complete" && typeof raw.completedAt === "string"
          ? raw.completedAt
          : undefined,
    };
  });
  if (invalidSteps.has(2)) invalidSteps.add(3);
  if (invalidSteps.has(5)) invalidSteps.add(6);
  const migratedSteps = steps.map((step) =>
    invalidSteps.has(step.id)
      ? {
          ...step,
          status:
            step.status === "ready" ? ("ready" as const) : ("locked" as const),
          output: undefined,
          discovery: undefined,
          completedAt: undefined,
          staleReason: "Restored output requires fresh validation.",
        }
      : step,
  );
  const firstIncomplete =
    migratedSteps.find(
      (step) => step.status !== "complete" && step.status !== "locked",
    ) || migratedSteps.find((step) => step.status !== "complete");
  return {
    ...initial,
    phase: firstIncomplete ? "active" : "complete",
    running: false,
    currentStep: (firstIncomplete?.id || 7) as CriticalReadStepID,
    status: "Restored Critical Read state was validated before use.",
    steps: migratedSteps,
    // Reports are always regenerated from the validated migrated step state.
    reportMarkdown: undefined,
    reportNoteItemID: undefined,
    startedAt:
      typeof source.startedAt === "string" ? source.startedAt : undefined,
    updatedAt:
      typeof source.updatedAt === "string"
        ? source.updatedAt
        : new Date().toISOString(),
  };
}

function persistedCriticalReadState(value: unknown) {
  if (!hasCriticalReadState(value)) return undefined;
  const cloned = cloneValue(value) as Record<string, unknown>;
  if (cloned.running === true) {
    cloned.running = false;
    cloned.status =
      "The previous Critical Read run was interrupted. Resume the current step.";
    cloned.steps = (cloned.steps as unknown[]).map((step) =>
      isPlainObject(step) && step.status === "running"
        ? { ...step, status: "ready" }
        : step,
    );
  }
  return cloned;
}

function getPersistedMessages(sessionId: string) {
  const prefs = resolveSessionHistoryPrefs();
  if (!prefs.persistHistory) {
    return [];
  }

  return messageStore
    .listRaw(sessionId)
    .filter(
      (message) => message.role === "user" || prefs.persistAssistantMessages,
    )
    .map((message) => cloneValue(message));
}

function getSnapshotTitle(
  session: PaperSession,
  messages: MessageRecord[],
  now: Date,
) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (firstUserMessage?.text?.trim()) {
    return buildSessionTitle(
      firstUserMessage.text,
      new Date(session.createdAt),
    );
  }

  if (session.threadTitle.trim()) {
    return session.threadTitle.trim();
  }

  return buildSessionTitle("", now);
}

export function captureSessionSnapshot(params: {
  session: PaperSession;
  now?: Date;
}): SessionHistorySnapshot | undefined {
  const prefs = resolveSessionHistoryPrefs();
  if (!prefs.persistHistory) {
    return undefined;
  }

  const now = params.now || new Date();
  const messages = getPersistedMessages(params.session.sessionId);
  const data = getAddonData();
  const paperArtifacts = prefs.persistAssistantDerivedState
    ? cloneValue(
        hasCards(data.paperArtifactStates?.get(params.session.itemID))
          ? data.paperArtifactStates?.get(params.session.itemID)
          : undefined,
      )
    : undefined;
  const relatedRecommendations = prefs.persistAssistantDerivedState
    ? cloneValue(
        hasGroups(data.relatedRecommendationStates?.get(params.session.itemID))
          ? data.relatedRecommendationStates?.get(params.session.itemID)
          : undefined,
      )
    : undefined;
  const mastery = prefs.persistAssistantDerivedState
    ? cloneValue(
        isCompletedMasteryState(
          data.comprehensionCheckStates?.get(params.session.itemID),
        )
          ? data.comprehensionCheckStates?.get(params.session.itemID)
          : undefined,
      )
    : undefined;
  const criticalRead = prefs.persistAssistantDerivedState
    ? persistedCriticalReadState(
        data.criticalReadStates?.get(params.session.itemID),
      )
    : undefined;

  if (
    !messages.length &&
    !paperArtifacts &&
    !relatedRecommendations &&
    !mastery &&
    !criticalRead
  ) {
    return undefined;
  }

  return {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    sessionId: params.session.sessionId,
    paperItemID: params.session.itemID,
    title: getSnapshotTitle(params.session, messages, now),
    createdAt: params.session.createdAt,
    updatedAt: now.toISOString(),
    lastMode: params.session.mode,
    messages,
    ...(params.session.lastCodexSessionID
      ? { lastCodexSessionID: params.session.lastCodexSessionID }
      : {}),
    ...(params.session.lastClaudeSessionID
      ? { lastClaudeSessionID: params.session.lastClaudeSessionID }
      : {}),
    ...(params.session.lastGeminiSessionID
      ? { lastGeminiSessionID: params.session.lastGeminiSessionID }
      : {}),
    ...(params.session.lastModel
      ? { lastModel: cloneValue(params.session.lastModel) }
      : {}),
    ...(paperArtifacts ? { paperArtifacts } : {}),
    ...(relatedRecommendations ? { relatedRecommendations } : {}),
    ...(mastery ? { mastery } : {}),
    ...(criticalRead ? { criticalRead } : {}),
  };
}

export function applySessionSnapshot(
  snapshot: SessionHistorySnapshot,
): PaperSession {
  const data = getAddonData();

  messageStore.replace(snapshot.sessionId, cloneValue(snapshot.messages ?? []));

  if (snapshot.paperArtifacts) {
    data.paperArtifactStates?.set(
      snapshot.paperItemID,
      cloneValue(snapshot.paperArtifacts),
    );
  } else {
    data.paperArtifactStates?.delete(snapshot.paperItemID);
  }

  if (snapshot.relatedRecommendations) {
    const recommendations = migrateRecommendationState(
      snapshot.relatedRecommendations,
    );
    if (recommendations) {
      data.relatedRecommendationStates?.set(snapshot.paperItemID, {
        ...recommendations,
        sessionID: snapshot.sessionId,
      });
    } else {
      data.relatedRecommendationStates?.delete(snapshot.paperItemID);
    }
  } else {
    data.relatedRecommendationStates?.delete(snapshot.paperItemID);
  }

  if (snapshot.mastery && isCompletedMasteryState(snapshot.mastery)) {
    data.comprehensionCheckStates?.set(
      snapshot.paperItemID,
      cloneValue(snapshot.mastery),
    );
  } else {
    data.comprehensionCheckStates?.delete(snapshot.paperItemID);
  }

  if (snapshot.criticalRead && hasCriticalReadState(snapshot.criticalRead)) {
    const criticalRead = migrateCriticalReadState(snapshot.criticalRead);
    if (criticalRead) {
      data.criticalReadStates?.set(snapshot.paperItemID, {
        ...criticalRead,
        itemID: snapshot.paperItemID,
        sessionID: snapshot.sessionId,
      });
    } else {
      data.criticalReadStates?.delete(snapshot.paperItemID);
    }
  } else {
    data.criticalReadStates?.delete(snapshot.paperItemID);
  }

  if (snapshot.lastMode) {
    data.modeOverrides?.set(snapshot.paperItemID, snapshot.lastMode);
  }

  return {
    sessionId: snapshot.sessionId,
    itemID: snapshot.paperItemID,
    mode: snapshot.lastMode || "codex_cli",
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    lastCodexSessionID: snapshot.lastCodexSessionID,
    lastClaudeSessionID: snapshot.lastClaudeSessionID,
    lastGeminiSessionID: snapshot.lastGeminiSessionID,
    lastModel: cloneValue(snapshot.lastModel),
    threadTitle: snapshot.title,
  };
}
