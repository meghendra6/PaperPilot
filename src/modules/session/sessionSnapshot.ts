import type { ComprehensionCheckState } from "../comprehensionCheck/types";
import { messageStore } from "../message/messageStore";
import type { MessageRecord } from "../message/types";
import { setPref } from "../../utils/prefs";
import { resolveSessionHistoryPrefs } from "./historyPrefs";
import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistorySnapshot,
} from "./historyTypes";
import { buildSessionTitle } from "./sessionTitle";
import type { PaperSession } from "./types";

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
  const data = (
    globalThis as typeof globalThis & {
      addon?: {
        data: {
          currentSessionId?: string;
          modeOverrides?: Map<number, "gemini_cli" | "codex_cli">;
          paperArtifactStates?: Map<number, unknown>;
          relatedRecommendationStates?: Map<number, unknown>;
          comprehensionCheckStates?: Map<number, unknown>;
        };
      };
    }
  ).addon?.data;

  return (
    data || {
      currentSessionId: undefined,
      modeOverrides: undefined,
      paperArtifactStates: undefined,
      relatedRecommendationStates: undefined,
      comprehensionCheckStates: undefined,
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

function getPersistedMessages(sessionId: string) {
  const prefs = resolveSessionHistoryPrefs();
  if (!prefs.persistHistory) {
    return [];
  }

  return messageStore
    .listRaw(sessionId)
    .filter(
      (message) =>
        message.role === "user" || prefs.persistAssistantMessages,
    )
    .map((message) => cloneValue(message));
}

function getSnapshotTitle(session: PaperSession, messages: MessageRecord[], now: Date) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (firstUserMessage?.text?.trim()) {
    return buildSessionTitle(firstUserMessage.text, new Date(session.createdAt));
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

  if (
    !messages.length &&
    !paperArtifacts &&
    !relatedRecommendations &&
    !mastery
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
    ...(params.session.lastGeminiSessionID
      ? { lastGeminiSessionID: params.session.lastGeminiSessionID }
      : {}),
    ...(params.session.lastModel
      ? { lastModel: cloneValue(params.session.lastModel) }
      : {}),
    ...(paperArtifacts ? { paperArtifacts } : {}),
    ...(relatedRecommendations ? { relatedRecommendations } : {}),
    ...(mastery ? { mastery } : {}),
  };
}

function applySavedModel(snapshot: SessionHistorySnapshot) {
  if (!snapshot.lastModel?.model) {
    return;
  }

  if (snapshot.lastModel.mode === "gemini_cli") {
    setPref("geminiDefaultModel", snapshot.lastModel.model);
    return;
  }

  setPref("codexDefaultModel", snapshot.lastModel.model);
  if (snapshot.lastModel.reasoningEffort) {
    setPref("codexReasoningEffort", snapshot.lastModel.reasoningEffort);
  }
}

export function applySessionSnapshot(snapshot: SessionHistorySnapshot): PaperSession {
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
    data.relatedRecommendationStates?.set(
      snapshot.paperItemID,
      cloneValue(snapshot.relatedRecommendations),
    );
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

  if (snapshot.lastMode) {
    data.modeOverrides?.set(snapshot.paperItemID, snapshot.lastMode);
  }
  applySavedModel(snapshot);

  return {
    sessionId: snapshot.sessionId,
    itemID: snapshot.paperItemID,
    mode: snapshot.lastMode || "codex_cli",
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    lastCodexSessionID: snapshot.lastCodexSessionID,
    lastGeminiSessionID: snapshot.lastGeminiSessionID,
    lastModel: cloneValue(snapshot.lastModel),
    threadTitle: snapshot.title,
  };
}
