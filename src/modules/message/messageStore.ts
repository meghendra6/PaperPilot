import { getPref } from "../../utils/prefs";
import { sanitizeAssistantText } from "./assistantOutput";
import type { MessageRecord } from "./types";

function shouldExposeAssistantMessage(message: MessageRecord) {
  if (message.role !== "assistant") {
    return true;
  }

  if (getPref("privacySavePromptsOnly")) {
    return false;
  }
  if (!getPref("privacySaveResponses")) {
    return false;
  }

  return true;
}

class MessageStore {
  private messages = new Map<string, MessageRecord[]>();

  listRaw(sessionId: string) {
    return this.messages.get(sessionId) ?? [];
  }

  list(sessionId: string) {
    const messages = this.listRaw(sessionId);

    if (!getPref("privacyStoreLocalHistory")) {
      return messages.filter((message) => message.role !== "assistant");
    }

    return messages.filter(shouldExposeAssistantMessage);
  }

  recent(sessionId: string, count: number) {
    return this.list(sessionId).slice(-count);
  }

  recentRaw(sessionId: string, count: number) {
    return this.listRaw(sessionId).slice(-count);
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
