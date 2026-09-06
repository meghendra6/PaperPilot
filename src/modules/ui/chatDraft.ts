import {
  immutableChatRequest,
  type ChatRequestSnapshot,
  type ChatResponseLength,
} from "../message/chatTypes";

export interface ChatDraftContext {
  text?: string;
  annotationIDs?: string[];
  attachmentID?: number;
  pageIndex?: number;
  pageLabel?: string;
}
export interface ChatDraft {
  revision: number;
  text: string;
  responseLength: ChatResponseLength;
  context?: ChatDraftContext;
  submission?: ChatDraftSubmission;
}
export interface ChatDraftSubmission {
  turnId: string;
  request: ChatRequestSnapshot;
}
let submissionSequence = 0;
export function createChatDraftSubmission(
  request: ChatRequestSnapshot,
): ChatDraftSubmission {
  return {
    turnId: `turn:${Date.now()}:${++submissionSequence}`,
    request: immutableChatRequest(request),
  };
}
const drafts = new Map<string, ChatDraft>();
const key = (itemID: number, sessionId: string) => `${itemID}:${sessionId}`;
const copy = (draft: ChatDraft): ChatDraft => JSON.parse(JSON.stringify(draft));
export function getChatDraft(itemID: number, sessionId: string): ChatDraft {
  return copy(
    drafts.get(key(itemID, sessionId)) ?? {
      revision: 0,
      text: "",
      responseLength: "default",
    },
  );
}
export function updateChatDraft(
  itemID: number,
  sessionId: string,
  patch: Partial<Omit<ChatDraft, "revision">>,
): ChatDraft {
  const current = getChatDraft(itemID, sessionId);
  const next = { ...current, ...patch, revision: current.revision + 1 };
  if (
    ["text", "context", "responseLength"].some(
      (field) =>
        Object.prototype.hasOwnProperty.call(patch, field) &&
        JSON.stringify(patch[field as keyof typeof patch]) !==
          JSON.stringify(current[field as keyof ChatDraft]),
    )
  )
    delete next.submission;
  drafts.set(key(itemID, sessionId), copy(next));
  return copy(next);
}
/** Consume only the admitted revision. Typing a next question cannot be erased. */
export function consumeChatDraft(
  itemID: number,
  sessionId: string,
  revision: number,
): boolean {
  const current = getChatDraft(itemID, sessionId);
  if (current.revision !== revision) return false;
  drafts.set(key(itemID, sessionId), {
    ...current,
    text: "",
    context: undefined,
    submission: undefined,
    revision: revision + 1,
  });
  return true;
}
/** A preparation failure restores A only if the user has not started B. */
export function restoreChatDraft(
  itemID: number,
  sessionId: string,
  admitted: ChatDraft,
  submission?: ChatDraftSubmission,
): boolean {
  const current = getChatDraft(itemID, sessionId);
  if (
    current.revision !== admitted.revision + 1 ||
    current.text ||
    current.context
  )
    return false;
  drafts.set(key(itemID, sessionId), {
    ...copy(admitted),
    ...(submission ? { submission } : {}),
    revision: current.revision + 1,
  });
  return true;
}
export function clearChatDrafts(): void {
  drafts.clear();
}
