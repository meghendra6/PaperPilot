import type { EngineMode } from "../ai/types";
import { buildSessionTitle } from "./sessionTitle";
import type { PaperSession } from "./types";

class SessionStore {
  private sessions = new Map<string, PaperSession>();

  private getKey(itemID: number) {
    return String(itemID);
  }

  get(itemID: number) {
    return this.sessions.get(this.getKey(itemID));
  }

  set(session: PaperSession) {
    this.sessions.set(this.getKey(session.itemID), session);
    return session;
  }

  getOrCreate(itemID: number, mode: EngineMode, title?: string): PaperSession {
    const key = this.getKey(itemID);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.mode = mode;
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
      threadTitle: title || buildSessionTitle("", new Date(now)),
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

  reset(itemID: number, _mode?: EngineMode) {
    this.sessions.delete(this.getKey(itemID));
  }
}

export const sessionStore = new SessionStore();
