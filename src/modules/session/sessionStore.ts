import type { EngineMode } from "../ai/types";
import type { PaperSession } from "./types";

class SessionStore {
  private sessions = new Map<string, PaperSession>();

  private getKey(itemID: number, mode: EngineMode) {
    return `${itemID}:${mode}`;
  }

  getOrCreate(itemID: number, mode: EngineMode, title?: string): PaperSession {
    const key = this.getKey(itemID, mode);
    const existing = this.sessions.get(key);
    if (existing) {
      if (title) {
        existing.threadTitle = title;
      }
      return existing;
    }

    const now = new Date().toISOString();
    const session: PaperSession = {
      sessionId: `paper-${itemID}-${mode}-${Date.now()}`,
      itemID,
      mode,
      createdAt: now,
      updatedAt: now,
      threadTitle: title || `Paper ${itemID} · ${mode}`,
    };
    this.sessions.set(key, session);
    return session;
  }

  touch(itemID: number, mode: EngineMode, title?: string) {
    const session = this.getOrCreate(itemID, mode, title);
    session.updatedAt = new Date().toISOString();
    return session;
  }

  update(
    itemID: number,
    mode: EngineMode,
    title: string | undefined,
    updater: (session: PaperSession) => void,
  ) {
    const session = this.getOrCreate(itemID, mode, title);
    updater(session);
    session.updatedAt = new Date().toISOString();
    return session;
  }

  reset(itemID: number, mode: EngineMode) {
    this.sessions.delete(this.getKey(itemID, mode));
  }
}

export const sessionStore = new SessionStore();
