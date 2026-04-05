import type { EngineMode } from "../ai/types";

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  sourceMode: EngineMode;
  status: "done" | "error";
  rawEvent?: string;
}
