import { classifyRunFailure, type RunFailureSource } from "./runFailure";
import {
  createRunProgressState,
  getRunProgressState,
  setRunProgressState,
  transitionRunProgress,
  type RunProgressState,
} from "./runProgress";
import {
  notifyReaderPaneStateChanged,
  type ReaderRunCompletionResult,
  type ReaderRunToken,
} from "./runPresentation";
import type { EngineMode } from "./types";
import { sessionHistoryService } from "../session/sessionHistoryService";

declare const addon: any;

export interface LastEngineRequest {
  mode: EngineMode;
  sessionId: string;
  sessionTitle: string;
  paperTitle?: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  useResume?: boolean;
  resumeSessionId?: string;
}

export interface PendingEngineCompletion {
  mode: EngineMode;
  token: ReaderRunToken;
  workspacePath?: string;
  retryable: boolean;
  cancelTimeout?: () => void;
  onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
}

function pendingCompletions(): Map<number, PendingEngineCompletion> {
  return (addon.data.pendingEngineCompletions ??= new Map()) as Map<
    number,
    PendingEngineCompletion
  >;
}

export function rememberLastEngineRequest(
  itemID: number,
  request: LastEngineRequest,
): void {
  (addon.data.lastEngineRequests ??= new Map()).set(itemID, request);
}

export function getLastEngineRequest(
  itemID: number,
): LastEngineRequest | undefined {
  return addon.data.lastEngineRequests?.get(itemID);
}

export function hasLastEngineRequest(itemID: number): boolean {
  return Boolean(getLastEngineRequest(itemID));
}

export function registerPendingEngineCompletion(
  itemID: number,
  completion: PendingEngineCompletion,
): void {
  pendingCompletions().set(itemID, completion);
}

export function getPendingEngineCompletion(
  itemID: number,
): PendingEngineCompletion | undefined {
  return pendingCompletions().get(itemID);
}

export function clearPendingEngineCompletion(
  itemID: number,
  token: ReaderRunToken,
): void {
  if (pendingCompletions().get(itemID)?.token === token) {
    pendingCompletions().delete(itemID);
  }
}

export function startRunProgress(
  itemID: number,
  engine: EngineMode,
): RunProgressState {
  const state = createRunProgressState({ itemID, engine });
  setRunProgressState(state);
  notifyReaderPaneStateChanged(itemID);
  return state;
}

export function advanceRunProgress(
  itemID: number,
  event:
    | { type: "spawned"; processId?: string }
    | { type: "finishing" }
    | { type: "completed" }
    | { type: "cancelled"; canRetry?: boolean },
): RunProgressState | undefined {
  const current = getRunProgressState(itemID);
  if (!current) return undefined;
  const next = transitionRunProgress(current, {
    ...event,
    at: Date.now(),
    ...(event.type === "cancelled"
      ? { canRetry: event.canRetry ?? hasLastEngineRequest(itemID) }
      : {}),
  });
  setRunProgressState(next);
  notifyReaderPaneStateChanged(itemID);
  return next;
}

export function failRunProgress(params: {
  itemID: number;
  engine: EngineMode;
  rawError: string;
  source: RunFailureSource;
  canRetry?: boolean;
}): RunProgressState {
  const current =
    getRunProgressState(params.itemID) ??
    createRunProgressState({ itemID: params.itemID, engine: params.engine });
  const failure = classifyRunFailure(params);
  const next = transitionRunProgress(current, {
    type: "failed",
    at: Date.now(),
    failure,
    canRetry: params.canRetry ?? hasLastEngineRequest(params.itemID),
  });
  setRunProgressState(next);
  notifyReaderPaneStateChanged(params.itemID);
  return next;
}

export async function persistRunFailure(params: {
  itemID: number;
  sessionId: string;
  sessionTitle: string;
  paperTitle?: string;
  engine: EngineMode;
  rawError: string;
  source: RunFailureSource;
  suppressMessage?: boolean;
}) {
  const state = failRunProgress({
    ...params,
    canRetry: !params.suppressMessage,
  });
  const failure = state.failure!;
  await sessionHistoryService.persistAssistantTurn({
    itemID: params.itemID,
    sessionId: params.sessionId,
    mode: params.engine,
    paperTitle: params.paperTitle || params.sessionTitle,
    assistantText: failure.userMessage,
    success: false,
    rawEvent: failure.rawError,
    suppressMessage: params.suppressMessage,
  });
  return failure;
}
