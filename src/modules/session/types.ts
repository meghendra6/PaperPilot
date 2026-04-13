import type { EngineMode } from "../ai/types";
import type { SessionHistoryModelMetadata } from "./historyTypes";

export interface PaperSession {
  sessionId: string;
  itemID: number;
  attachmentID?: number;
  mode: EngineMode;
  createdAt: string;
  updatedAt: string;
  lastCodexSessionID?: string;
  lastGeminiSessionID?: string;
  lastModel?: SessionHistoryModelMetadata;
  threadTitle: string;
}
