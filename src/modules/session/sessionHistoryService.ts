import { captureSessionSnapshot, applySessionSnapshot } from "./sessionSnapshot";
import { sessionHistoryRepository, SessionHistoryRepository } from "./sessionHistoryRepository";
import { sessionStore } from "./sessionStore";
import { messageStore } from "../message/messageStore";
import type { EngineMode } from "../ai/types";
import { buildSessionTitle } from "./sessionTitle";
import { sanitizeAssistantText } from "../message/assistantOutput";
import type { MessageRecord } from "../message/types";
import { resolveSessionHistoryPrefs } from "./historyPrefs";

export interface SessionHistoryServiceOptions {
  repository?: SessionHistoryRepository;
  now?: () => Date;
}

function getAddonData() {
  return (
    globalThis as typeof globalThis & {
      addon?: { data: { currentSessionId?: string } };
    }
  ).addon?.data;
}

function trimSessionTitle(title: string) {
  return title.trim();
}

function buildAssistantMessageRecord(params: {
  sessionId: string;
  createdAt: string;
  assistantText: string;
  mode: EngineMode;
  success: boolean;
  rawEvent?: string;
  index: number;
}): MessageRecord {
  return {
    id: `${params.sessionId}-${Date.parse(params.createdAt)}-${params.index}`,
    role: "assistant",
    text: sanitizeAssistantText(params.assistantText),
    createdAt: params.createdAt,
    sourceMode: params.mode,
    status: params.success ? "done" : "error",
    ...(params.rawEvent ? { rawEvent: params.rawEvent } : {}),
  };
}

function applyResumeMetadata<T extends {
  lastCodexSessionID?: string;
  lastGeminiSessionID?: string;
}>(target: T, params: {
  mode: EngineMode;
  success: boolean;
  resumeSessionId?: string;
}) {
  if (params.mode === "codex_cli" && params.success) {
    target.lastCodexSessionID =
      params.resumeSessionId || target.lastCodexSessionID || "last";
  }
  if (params.mode === "gemini_cli" && params.success) {
    target.lastGeminiSessionID =
      params.resumeSessionId || target.lastGeminiSessionID || "latest";
  }
}

function shouldPreserveSessionTitle(
  sessionTitle: string | undefined,
  createdAt: string,
  paperTitle: string,
  persistedTitle?: string,
) {
  const trimmedSessionTitle = trimSessionTitle(sessionTitle || "");
  if (!trimmedSessionTitle) {
    return false;
  }

  if (trimmedSessionTitle === trimSessionTitle(persistedTitle || "")) {
    return true;
  }

  const trimmedPaperTitle = trimSessionTitle(paperTitle);
  if (trimmedSessionTitle === trimmedPaperTitle) {
    return false;
  }

  return trimmedSessionTitle !== buildSessionTitle("", new Date(createdAt));
}

export class SessionHistoryService {
  private readonly repository: SessionHistoryRepository;
  private readonly now: () => Date;

  constructor(options: SessionHistoryServiceOptions = {}) {
    this.repository = options.repository || sessionHistoryRepository;
    this.now = options.now || (() => new Date());
  }

  ensureDraftSession(params: {
    itemID: number;
    mode: "gemini_cli" | "codex_cli";
    title?: string;
  }) {
    const session = sessionStore.getOrCreate(
      params.itemID,
      params.mode,
      params.title,
    );
    const data = getAddonData();
    if (data) {
      data.currentSessionId = session.sessionId;
    }
    return session;
  }

  async listSavedSessions(params: { itemID: number }) {
    return this.repository.listSessions(params.itemID);
  }

  async persistActiveSession(params: { itemID: number; paperTitle: string }) {
    const session = sessionStore.get(params.itemID);
    if (!session) {
      return undefined;
    }

    const capturedSnapshot = captureSessionSnapshot({
      session,
      now: this.now(),
    });
    if (!capturedSnapshot) {
      return undefined;
    }

    const existingSnapshot = await this.repository.readSessionSnapshot(
      params.itemID,
      session.sessionId,
    );

    const snapshot = shouldPreserveSessionTitle(
      session.threadTitle,
      session.createdAt,
      params.paperTitle,
      existingSnapshot?.title,
    )
      ? {
          ...capturedSnapshot,
          title: trimSessionTitle(session.threadTitle),
        }
      : capturedSnapshot;

    sessionStore.set({
      ...session,
      mode: snapshot.lastMode || session.mode,
      updatedAt: snapshot.updatedAt,
      lastModel: snapshot.lastModel,
      threadTitle: snapshot.title,
    });

    await this.repository.saveSessionSnapshot({
      paperItemID: params.itemID,
      paperTitle: params.paperTitle,
      snapshot,
    });

    return snapshot;
  }

  async persistUserMessage(params: {
    itemID: number;
    mode: EngineMode;
    paperTitle: string;
    text: string;
  }) {
    const session = sessionStore.touch(params.itemID, params.mode);
    messageStore.append(session.sessionId, {
      role: "user",
      text: params.text,
      sourceMode: params.mode,
      status: "done",
    });

    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });

    return session;
  }

  async persistAssistantTurn(params: {
    itemID: number;
    sessionId: string;
    mode: EngineMode;
    paperTitle: string;
    assistantText: string;
    success: boolean;
    rawEvent?: string;
    resumeSessionId?: string;
  }) {
    const session = sessionStore.get(params.itemID);
    const createdAt = this.now().toISOString();

    if (!session || session.sessionId !== params.sessionId) {
      const snapshot = await this.repository.readSessionSnapshot(
        params.itemID,
        params.sessionId,
      );
      if (!snapshot) {
        return undefined;
      }

      const messages = [...(snapshot.messages ?? [])];
      const prefs = resolveSessionHistoryPrefs();
      if (prefs.persistAssistantMessages) {
        messages.push(
          buildAssistantMessageRecord({
            sessionId: params.sessionId,
            createdAt,
            assistantText: params.assistantText,
            mode: params.mode,
            success: params.success,
            rawEvent: params.rawEvent,
            index: messages.length,
          }),
        );
      }
      const updatedSnapshot = {
        ...snapshot,
        updatedAt: createdAt,
        lastMode: params.mode,
        messages,
      };
      applyResumeMetadata(updatedSnapshot, params);
      await this.repository.saveSessionSnapshot({
        paperItemID: params.itemID,
        paperTitle: params.paperTitle,
        snapshot: updatedSnapshot,
      });
      return updatedSnapshot;
    }

    messageStore.append(session.sessionId, {
      role: "assistant",
      text: params.assistantText,
      sourceMode: params.mode,
      status: params.success ? "done" : "error",
      ...(params.rawEvent ? { rawEvent: params.rawEvent } : {}),
    });

    sessionStore.update(
      params.itemID,
      params.mode,
      session.threadTitle,
      (existing) => {
        applyResumeMetadata(existing, params);
      },
    );

    return this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
  }

  async openSavedSession(params: { itemID: number; sessionId: string }) {
    const snapshot = await this.repository.readSessionSnapshot(
      params.itemID,
      params.sessionId,
    );
    if (!snapshot) {
      return undefined;
    }

    const session = applySessionSnapshot(snapshot);
    sessionStore.set(session);
    const data = getAddonData();
    if (data) {
      data.currentSessionId = session.sessionId;
    }
    return session;
  }

  async renameSavedSession(params: {
    itemID: number;
    sessionId: string;
    title: string;
  }) {
    const snapshot = await this.repository.readSessionSnapshot(
      params.itemID,
      params.sessionId,
    );
    const title = trimSessionTitle(params.title);
    if (!snapshot || !title) {
      return undefined;
    }

    const renamedSnapshot = {
      ...snapshot,
      title,
      updatedAt: this.now().toISOString(),
    };
    const index = await this.repository.readPaperIndex(params.itemID);
    await this.repository.saveSessionSnapshot({
      paperItemID: params.itemID,
      paperTitle: index.paperTitle,
      snapshot: renamedSnapshot,
    });

    const activeSession = sessionStore.get(params.itemID);
    if (activeSession?.sessionId === params.sessionId) {
      sessionStore.set({
        ...activeSession,
        threadTitle: title,
        updatedAt: renamedSnapshot.updatedAt,
      });
    }

    return renamedSnapshot;
  }

  async deleteSavedSession(params: { itemID: number; sessionId: string }) {
    await this.repository.deleteSession(params.itemID, params.sessionId);
    const activeSession = sessionStore.get(params.itemID);
    if (activeSession?.sessionId === params.sessionId) {
      sessionStore.reset(params.itemID, activeSession.mode);
      const data = getAddonData();
      if (data?.currentSessionId === params.sessionId) {
        data.currentSessionId = undefined;
      }
    }
  }

  async deleteAllSavedSessions(params: { itemID: number }) {
    await this.repository.deleteAllSessions(params.itemID);
    const activeSession = sessionStore.get(params.itemID);
    if (activeSession) {
      sessionStore.reset(params.itemID, activeSession.mode);
    }
    const data = getAddonData();
    if (data) {
      data.currentSessionId = undefined;
    }
  }

  async startNewSessionDraft(params: {
    itemID: number;
    mode: EngineMode;
    paperTitle: string;
  }) {
    await this.persistActiveSession({
      itemID: params.itemID,
      paperTitle: params.paperTitle,
    });
    sessionStore.reset(params.itemID, params.mode);
    return this.ensureDraftSession({
      itemID: params.itemID,
      mode: params.mode,
      title: params.paperTitle,
    });
  }
}

export const sessionHistoryService = new SessionHistoryService();
