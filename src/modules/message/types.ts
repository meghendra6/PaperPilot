import type { EngineMode } from "../ai/types";
import type {
  ChatAttempt,
  ChatCitation,
  ChatRequestSnapshot,
} from "./chatTypes";
import type { RequestContextSnapshot } from "../context/requestContext";
import type { ExecutionSettings } from "../ai/executionSettings";

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  sourceMode: EngineMode;
  status: "done" | "error";
  rawEvent?: string;
  turnId?: string;
  attemptId?: string;
  attempts?: ChatAttempt[];
  request?: ChatRequestSnapshot;
  requestContext?: RequestContextSnapshot;
  executionSettings?: ExecutionSettings;
  citations?: ChatCitation[];
  provenance?: { sessionId: string; messageId: string };
}
