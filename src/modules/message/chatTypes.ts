import type { ExecutionSettings } from "../ai/executionSettings";
import type { EngineMode } from "../ai/types";
import type { RequestContextSnapshot } from "../context/requestContext";
import type { EvidenceReferenceV2 } from "../researchWorkspace/evidenceVerification";
import type { ChatCitationCandidate } from "./chatAnswer";

export type ChatResponseLength = "short" | "default" | "detailed";
export type ChatAttemptState =
  | "pending"
  | "running"
  | "finishing"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface ChatRequestSnapshot {
  readonly question: string;
  readonly requestContext?: RequestContextSnapshot;
  readonly executionSettings?: ExecutionSettings;
  readonly responseLength: ChatResponseLength;
}
export interface ChatAttempt {
  id: string;
  turnId: string;
  ordinal: number;
  state: ChatAttemptState;
  startedAt: string;
  finishedAt?: string;
  assistantMessageId?: string;
  errorCategory?: string;
}
export interface ChatCitation extends ChatCitationCandidate {
  sourceFingerprint: string;
  status:
    | "unverified"
    | "verified"
    | "not-found"
    | "source-unavailable"
    | "stale";
  reference?: EvidenceReferenceV2;
}
export interface ConversationPin {
  id: string;
  messageId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}
export interface ConversationSummary {
  text: string;
  basedOnMessageId: string;
  sourceFingerprint: string;
  createdAt: string;
  author: "model";
}
export interface ConversationBranch {
  parentSessionId: string;
  branchPointMessageId: string;
  kind: "answer" | "edit";
}
export interface ProviderBinding {
  engine: EngineMode;
  sessionId?: string;
  status: "verified" | "unavailable";
  sourceID?: string;
  sourceFingerprint?: string;
  paperpilotSessionId: string;
}

export function cloneChatValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function immutableChatRequest(
  request: ChatRequestSnapshot,
): ChatRequestSnapshot {
  const copied = cloneChatValue(request);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  freeze(copied);
  return copied;
}
export function isTerminalAttempt(state: ChatAttemptState) {
  return !["pending", "running", "finishing"].includes(state);
}
