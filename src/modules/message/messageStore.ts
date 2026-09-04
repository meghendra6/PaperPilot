import { sanitizeAssistantText } from "./assistantOutput";
import type { MessageRecord } from "./types";
import { resolveSessionHistoryPrefs } from "../session/historyPrefs";

class MessageStore {
  private messages = new Map<string, MessageRecord[]>();

  listRaw(sessionId: string) {
    return this.messages.get(sessionId) ?? [];
  }

  list(sessionId: string) {
    return this.listRaw(sessionId);
  }

  recent(sessionId: string, count: number) {
    return this.list(sessionId).slice(-count);
  }

  recentRaw(sessionId: string, count: number) {
    return this.listRaw(sessionId).slice(-count);
  }

  recentForWorkspace(sessionId: string, count: number) {
    const prefs = resolveSessionHistoryPrefs();
    return this.listRaw(sessionId)
      .filter(
        (message) => message.role === "user" || prefs.persistAssistantMessages,
      )
      .slice(-count);
  }

  append(sessionId: string, message: Omit<MessageRecord, "id" | "createdAt">) {
    const existing = this.messages.get(sessionId) ?? [];
    const record = {
      ...message,
      text:
        message.role === "assistant"
          ? sanitizeAssistantText(message.text)
          : message.text,
      id: `${sessionId}-${Date.now()}-${existing.length}`,
      createdAt: new Date().toISOString(),
    };
    existing.push(record);
    this.messages.set(sessionId, existing);
    return record;
  }

  replace(sessionId: string, messages: MessageRecord[]) {
    this.messages.set(
      sessionId,
      messages.map((message) => ({ ...message })),
    );
  }

  clear(sessionId: string) {
    this.messages.delete(sessionId);
  }
}

export const messageStore = new MessageStore();
