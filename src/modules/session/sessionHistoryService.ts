import { captureSessionSnapshot, applySessionSnapshot } from "./sessionSnapshot";
import { sessionHistoryRepository, SessionHistoryRepository } from "./sessionHistoryRepository";
import { sessionStore } from "./sessionStore";
import { messageStore } from "../message/messageStore";
import type { EngineMode } from "../ai/types";

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

    const snapshot = captureSessionSnapshot({
      session,
      now: this.now(),
    });
    if (!snapshot) {
      return undefined;
    }

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
    const session = sessionStore.touch(params.itemID, params.mode, params.paperTitle);
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
    mode: EngineMode;
    paperTitle: string;
    assistantText: string;
    success: boolean;
    rawEvent?: string;
    resumeSessionId?: string;
  }) {
    const session = sessionStore.get(params.itemID);
    if (!session) {
      return undefined;
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
        if (params.mode === "codex_cli" && params.success) {
          existing.lastCodexSessionID =
            params.resumeSessionId || existing.lastCodexSessionID || "last";
        }
        if (params.mode === "gemini_cli" && params.success) {
          existing.lastGeminiSessionID =
            params.resumeSessionId || existing.lastGeminiSessionID || "latest";
        }
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
