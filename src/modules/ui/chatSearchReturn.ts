import { cloneChatValue } from "../message/chatTypes";
import { messageStore } from "../message/messageStore";
import { sessionStore } from "../session/sessionStore";
import type { PaperSession } from "../session/types";

const stateKeys = [
  "modeOverrides",
  "paperArtifactStates",
  "relatedRecommendationStates",
  "comprehensionCheckStates",
  "criticalReadStates",
] as const;
type SearchReturnData = {
  currentSessionId?: string;
} & Partial<Record<(typeof stateKeys)[number], Map<number, unknown>>>;

/** A temporary search visit must not depend on disk history or save a draft. */
export function captureChatSearchReturn(
  session: PaperSession,
  data: SearchReturnData,
) {
  const savedSession = cloneChatValue(session);
  const messages = cloneChatValue(messageStore.listRaw(session.sessionId));
  const states = stateKeys.map((key) => ({
    key,
    value: cloneChatValue(data[key]?.get(session.itemID)),
  }));
  return () => {
    sessionStore.set(cloneChatValue(savedSession));
    messageStore.replace(session.sessionId, cloneChatValue(messages));
    for (const { key, value } of states) {
      if (value === undefined) data[key]?.delete(session.itemID);
      else {
        const state = (data[key] ??= new Map());
        state.set(session.itemID, cloneChatValue(value));
      }
    }
    data.currentSessionId = session.sessionId;
    // The revisioned draft store already retains this session's latest input.
  };
}
