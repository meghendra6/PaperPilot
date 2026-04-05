import type { EngineMode } from "../ai/types";

export interface PaperSession {
  sessionId: string;
  itemID: number;
  attachmentID?: number;
  mode: EngineMode;
  createdAt: string;
  updatedAt: string;
  lastCodexSessionID?: string;
  lastGeminiSessionID?: string;
  threadTitle: string;
}
