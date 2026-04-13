import type { EngineMode } from "../ai/types";
import type { MessageRecord } from "../message/types";

export const SESSION_HISTORY_STORAGE_VERSION = 1 as const;

export type SessionHistoryStorageVersion =
  typeof SESSION_HISTORY_STORAGE_VERSION;

export type SessionHistoryPersistenceMode =
  | "disabled"
  | "prompts-only"
  | "full";

export interface SessionHistoryPrefsResolution {
  mode: SessionHistoryPersistenceMode;
  persistHistory: boolean;
  persistAssistantMessages: boolean;
  persistAssistantDerivedState: boolean;
}

export interface SessionHistoryModelMetadata {
  mode: EngineMode;
  model: string;
  reasoningEffort?: string;
}

export interface SessionHistorySnapshot {
  storageVersion: SessionHistoryStorageVersion;
  sessionId: string;
  paperItemID: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMode?: EngineMode;
  lastCodexSessionID?: string;
  lastGeminiSessionID?: string;
  lastModel?: SessionHistoryModelMetadata;
  messages?: MessageRecord[];
  paperArtifacts?: unknown;
  relatedRecommendations?: unknown;
  mastery?: unknown;
}

export interface SessionHistoryListEntry {
  storageVersion: SessionHistoryStorageVersion;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMode?: EngineMode;
  hasArtifacts: boolean;
  hasRecommendations: boolean;
  hasMasteryState: boolean;
}

export interface SessionHistoryIndex {
  storageVersion: SessionHistoryStorageVersion;
  paperItemID: number;
  paperTitle: string;
  sessions: SessionHistoryListEntry[];
}

export interface SessionHistoryFileOps {
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string | undefined>;
  writeTextAtomic(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface SessionHistoryRepositoryOptions {
  rootDir?: string;
  fileOps?: SessionHistoryFileOps;
  now?: () => Date;
}
