import { sanitizeAssistantText } from "./assistantOutput";
import type { MessageRecord } from "./types";
import { resolveSessionHistoryPrefs } from "../session/historyPrefs";
import {
  cloneChatValue,
  immutableChatRequest,
  isTerminalAttempt,
  type ChatAttemptState,
  type ChatRequestSnapshot,
} from "./chatTypes";

export function restoreMessageRecords(
  messages: MessageRecord[],
): MessageRecord[] {
  let turnId: string | undefined;
  return messages.map((original) => {
    const message = cloneChatValue(original);
    if (message.request)
      message.request = immutableChatRequest(message.request);
    if (message.role === "user")
      turnId = message.turnId || `turn:${message.id}`;
    message.turnId = message.turnId || turnId;
    if (message.attempts)
      message.attempts = message.attempts.map((attempt) => ({
        ...attempt,
        state: isTerminalAttempt(attempt.state) ? attempt.state : "interrupted",
      }));
    return message;
  });
}

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
        (message) =>
          message.status === "done" &&
          (message.role === "user" || prefs.persistAssistantMessages),
      )
      .slice(-count);
  }

  get(sessionId: string, messageId: string) {
    return this.listRaw(sessionId).find((message) => message.id === messageId);
  }

  getTurn(sessionId: string, turnId?: string) {
    const users = this.listRaw(sessionId).filter(
      (message) => message.role === "user",
    );
    return turnId
      ? users.find((message) => message.turnId === turnId)
      : users.at(-1);
  }

  setRequest(sessionId: string, turnId: string, request: ChatRequestSnapshot) {
    const turn = this.getTurn(sessionId, turnId);
    if (!turn) throw new Error("The question is no longer available.");
    if (
      turn.request &&
      JSON.stringify(turn.request) !== JSON.stringify(request)
    )
      throw new Error(
        "A submitted question cannot change. Edit it in a new conversation.",
      );
    turn.request = immutableChatRequest(request);
    return turn;
  }

  beginAttempt(sessionId: string, turnId?: string) {
    const turn = this.getTurn(sessionId, turnId);
    if (!turn) throw new Error("No question is available to run.");
    turn.turnId ||= `turn:${turn.id}`;
    turn.attempts ||= [];
    const previous = turn.attempts.at(-1);
    if (previous && !isTerminalAttempt(previous.state)) return previous;
    const attempt = {
      id: `${turn.turnId}:attempt:${turn.attempts.length + 1}`,
      turnId: turn.turnId,
      ordinal: turn.attempts.length + 1,
      state: "pending" as const,
      startedAt: new Date().toISOString(),
    };
    turn.attempts.push(attempt);
    return attempt;
  }

  transitionAttempt(
    sessionId: string,
    turnId: string,
    attemptId: string,
    state: ChatAttemptState,
    extra: { assistantMessageId?: string; errorCategory?: string } = {},
  ) {
    const attempt = this.getTurn(sessionId, turnId)?.attempts?.find(
      (entry) => entry.id === attemptId,
    );
    if (!attempt || isTerminalAttempt(attempt.state)) return false;
    const order = { pending: 0, running: 1, finishing: 2 };
    if (
      !isTerminalAttempt(state) &&
      order[state as keyof typeof order] <
        order[attempt.state as keyof typeof order]
    )
      return false;
    Object.assign(
      attempt,
      extra,
      { state },
      isTerminalAttempt(state) ? { finishedAt: new Date().toISOString() } : {},
    );
    return true;
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
    if (record.role === "user") record.turnId ||= `turn:${record.id}`;
    if (record.request) record.request = immutableChatRequest(record.request);
    existing.push(record);
    this.messages.set(sessionId, existing);
    return record;
  }

  replace(sessionId: string, messages: MessageRecord[]) {
    this.messages.set(
      sessionId,
      cloneChatValue(messages).map((message) => ({
        ...message,
        ...(message.request
          ? { request: immutableChatRequest(message.request) }
          : {}),
      })),
    );
  }

  clear(sessionId: string) {
    this.messages.delete(sessionId);
  }
}

export const messageStore = new MessageStore();
