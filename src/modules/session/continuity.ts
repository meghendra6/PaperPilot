import { messageStore } from "../message/messageStore";
import { sessionStore } from "./sessionStore";
import { resolveSessionHistoryPrefs } from "./historyPrefs";
import type { MessageRecord } from "../message/types";

export interface SessionContinuity {
  text: string;
  includedPins: number;
  includedTurns: number;
  omitted: number;
  usedSummary: boolean;
}

export function buildSessionContinuity(params: {
  sessionId: string;
  sourceFingerprint?: string;
  maxChars?: number;
}): SessionContinuity {
  const prefs = resolveSessionHistoryPrefs();
  const session = sessionStore.getBySessionId(params.sessionId);
  const messages = messageStore.listRaw(params.sessionId);
  const limit = Math.max(
    0,
    Math.min(24_000, Math.floor(params.maxChars ?? 24_000)),
  );
  const result: SessionContinuity = {
    text: "",
    includedPins: 0,
    includedTurns: 0,
    omitted: 0,
    usedSummary: false,
  };
  const blocks: string[] = [];
  let used = 0;
  const include = (text: string) => {
    const size = text.length + (blocks.length ? 2 : 0);
    if (used + size > limit) {
      result.omitted++;
      return false;
    }
    blocks.push(text);
    used += size;
    return true;
  };
  const pins = (session?.pins ?? []).filter(
    (pin) =>
      messages.some((message) => message.id === pin.messageId) &&
      (pin.role === "user" || prefs.persistAssistantMessages),
  );
  const includePin = (pin: (typeof pins)[number]) => {
    if (
      include(
        `${pin.role === "user" ? "User-defined context" : "Pinned assistant interpretation (not verified evidence)"}:\n${pin.text}`,
      )
    )
      result.includedPins++;
  };
  for (const pin of pins.filter((entry) => entry.role === "user"))
    includePin(pin);
  const summary = session?.summary;
  const summaryIndex = summary
    ? messages.findIndex((message) => message.id === summary.basedOnMessageId)
    : -1;
  if (
    prefs.persistAssistantMessages &&
    summary &&
    summaryIndex >= 0 &&
    summary.sourceFingerprint === params.sourceFingerprint &&
    include(
      `Model-generated conversation summary (not paper evidence):\n${summary.text}`,
    )
  )
    result.usedSummary = true;
  for (const pin of pins.filter((entry) => entry.role === "assistant"))
    includePin(pin);

  const groups: MessageRecord[][] = [];
  for (const message of messages.slice(
    result.usedSummary ? summaryIndex + 1 : 0,
  )) {
    if (message.role === "user") groups.push([message]);
    else if (
      groups.length &&
      message.status === "done" &&
      prefs.persistAssistantMessages
    )
      groups[groups.length - 1].push(message);
  }
  const completed = groups.filter((group) => {
    const attempts = group[0].attempts;
    return attempts?.length
      ? attempts.some((attempt) => attempt.state === "completed")
      : messages.some(
          (message) =>
            message.role === "assistant" &&
            message.status === "done" &&
            message.turnId === group[0].turnId,
        );
  });
  const recent: string[] = [];
  for (const group of [...completed].reverse()) {
    const lastAnswer = group
      .filter(
        (message) => message.role === "assistant" && message.status === "done",
      )
      .at(-1);
    const text = [group[0], ...(lastAnswer ? [lastAnswer] : [])]
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n");
    const size = text.length + (used || recent.length ? 2 : 0);
    if (used + size > limit) {
      result.omitted++;
      continue;
    }
    used += size;
    recent.unshift(text);
    result.includedTurns++;
  }
  result.text = [...blocks, ...recent].join("\n\n");
  return result;
}
