import type { EngineMode } from "../ai/types";
import type { SessionHistoryModelMetadata } from "./historyTypes";
import type {
  ConversationBranch,
  ConversationPin,
  ConversationSummary,
  ProviderBinding,
} from "../message/chatTypes";

export interface PaperSession {
  sessionId: string;
  itemID: number;
  attachmentID?: number;
  mode: EngineMode;
  createdAt: string;
  updatedAt: string;
  lastCodexSessionID?: string;
  lastClaudeSessionID?: string;
  lastGeminiSessionID?: string;
  lastModel?: SessionHistoryModelMetadata;
  threadTitle: string;
  branch?: ConversationBranch;
  pins?: ConversationPin[];
  summary?: ConversationSummary;
  providerBindings?: Partial<Record<EngineMode, ProviderBinding>>;
  lastTurnId?: string;
  lastAttemptId?: string;
}
