import { captureSessionSnapshot, applySessionSnapshot } from "./sessionSnapshot";
import { sessionHistoryRepository, SessionHistoryRepository } from "./sessionHistoryRepository";
import { sessionStore } from "./sessionStore";

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
}

export const sessionHistoryService = new SessionHistoryService();
