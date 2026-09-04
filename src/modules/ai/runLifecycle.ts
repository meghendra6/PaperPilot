import {
  classifyRunFailure,
  getEngineLabel,
  type RunFailureSource,
} from "./runFailure";
import {
  createRunProgressState,
  getRunProgressState,
  setRunProgressState,
  transitionRunProgress,
  type RunProgressState,
} from "./runProgress";
import {
  notifyReaderPaneStateChanged,
  restoreReaderRunOwnership,
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
  rearmTimeout?: () => void;
  onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
  terminalClaim?: "controller" | "cancel" | "timeout";
  cleanupClaimed?: boolean;
  preparationSettled?: boolean;
  terminalSettled?: boolean;
}

function pendingCompletions(): Map<number, PendingEngineCompletion> {
  return (addon.data.pendingEngineCompletions ??= new Map()) as Map<
    number,
    PendingEngineCompletion
  >;
}

type ReaderLifecycleClaimKind =
  | "chat_admission"
  | "direct_workspace"
  | "retry"
  | "session";

interface ReaderLifecycleClaim {
  kind: ReaderLifecycleClaimKind;
  token: symbol;
}

function readerLifecycleClaims(): Map<number, ReaderLifecycleClaim> {
  return (addon.data.readerLifecycleClaims ??= new Map()) as Map<
    number,
    ReaderLifecycleClaim
  >;
}

function claimReaderLifecycle(
  itemID: number,
  kind: ReaderLifecycleClaimKind,
): symbol | undefined {
  if (readerLifecycleClaims().has(itemID)) return undefined;
  const token = Symbol(`${itemID}:${kind}`);
  readerLifecycleClaims().set(itemID, { kind, token });
  return token;
}

function releaseReaderLifecycle(itemID: number, token: symbol): void {
  if (readerLifecycleClaims().get(itemID)?.token === token) {
    readerLifecycleClaims().delete(itemID);
  }
}

function hasReaderLifecycleClaim(
  itemID: number,
  kind: ReaderLifecycleClaimKind,
): boolean {
  return readerLifecycleClaims().get(itemID)?.kind === kind;
}

export function claimRetryEngineRequest(itemID: number): symbol | undefined {
  return claimReaderLifecycle(itemID, "retry");
}

export function claimChatEngineRequest(itemID: number): symbol | undefined {
  return claimReaderLifecycle(itemID, "chat_admission");
}

export function releaseChatEngineRequest(itemID: number, token: symbol): void {
  releaseReaderLifecycle(itemID, token);
}

export function isChatEngineRequestPending(itemID: number): boolean {
  return hasReaderLifecycleClaim(itemID, "chat_admission");
}

export function isReaderLifecycleClaimActive(itemID: number): boolean {
  return readerLifecycleClaims().has(itemID);
}

export function releaseRetryEngineRequest(itemID: number, token: symbol): void {
  releaseReaderLifecycle(itemID, token);
}

export function isRetryEngineRequestPending(itemID: number): boolean {
  return hasReaderLifecycleClaim(itemID, "retry");
}

export function claimDirectWorkspaceRun(itemID: number): symbol | undefined {
  return claimReaderLifecycle(itemID, "direct_workspace");
}

export function releaseDirectWorkspaceRun(itemID: number, token: symbol): void {
  releaseReaderLifecycle(itemID, token);
}

export function isDirectWorkspaceRunClaimed(itemID: number): boolean {
  return hasReaderLifecycleClaim(itemID, "direct_workspace");
}

export function isDirectWorkspaceRunClaimCurrent(
  itemID: number,
  token: symbol,
): boolean {
  const claim = readerLifecycleClaims().get(itemID);
  return claim?.kind === "direct_workspace" && claim.token === token;
}

export function claimReaderSessionTransition(
  itemID: number,
): symbol | undefined {
  return claimReaderLifecycle(itemID, "session");
}

export function releaseReaderSessionTransition(
  itemID: number,
  token: symbol,
): void {
  releaseReaderLifecycle(itemID, token);
}

export function isReaderSessionTransitionActive(itemID: number): boolean {
  return hasReaderLifecycleClaim(itemID, "session");
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

export function isPendingEngineCompletionCurrent(
  itemID: number,
  token: ReaderRunToken,
): boolean {
  return getPendingEngineCompletion(itemID)?.token === token;
}

export function claimPendingEngineCompletion(
  itemID: number,
  token: ReaderRunToken,
  claim: NonNullable<PendingEngineCompletion["terminalClaim"]>,
): PendingEngineCompletion | undefined {
  const pending = getPendingEngineCompletion(itemID);
  if (!pending || pending.token !== token || pending.terminalClaim) {
    return undefined;
  }
  pending.terminalClaim = claim;
  return pending;
}

export function releasePendingEngineCompletionClaim(
  itemID: number,
  token: ReaderRunToken,
  claim: NonNullable<PendingEngineCompletion["terminalClaim"]>,
): void {
  const pending = getPendingEngineCompletion(itemID);
  if (
    pending?.token === token &&
    pending.terminalClaim === claim &&
    !pending.terminalSettled
  ) {
    pending.terminalClaim = undefined;
  }
}

export function markPendingEnginePreparationSettled(
  itemID: number,
  token: ReaderRunToken,
): void {
  const pending = getPendingEngineCompletion(itemID);
  if (!pending || pending.token !== token) return;
  pending.preparationSettled = true;
  if (pending.terminalSettled) pendingCompletions().delete(itemID);
}

export function markPendingEngineTerminalSettled(
  itemID: number,
  token: ReaderRunToken,
): void {
  const pending = getPendingEngineCompletion(itemID);
  if (!pending || pending.token !== token) return;
  pending.terminalSettled = true;
  if (pending.preparationSettled) pendingCompletions().delete(itemID);
}

export function startRunProgress(
  itemID: number,
  engine: EngineMode,
  token: ReaderRunToken,
): RunProgressState {
  const state = createRunProgressState({ itemID, engine, token });
  setRunProgressState(state);
  notifyReaderPaneStateChanged(itemID);
  return state;
}

export function advanceRunProgress(
  itemID: number,
  token: ReaderRunToken,
  event:
    | { type: "spawned"; processId?: string }
    | { type: "finishing" }
    | { type: "completed" }
    | { type: "cancelled"; canRetry?: boolean },
): RunProgressState | undefined {
  const current = getRunProgressState(itemID);
  if (!current || current.token !== token) return undefined;
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
  token: ReaderRunToken;
  rawError: string;
  source: RunFailureSource;
  canRetry?: boolean;
}): RunProgressState | undefined {
  const current =
    getRunProgressState(params.itemID) ??
    createRunProgressState({
      itemID: params.itemID,
      engine: params.engine,
      token: params.token,
    });
  if (current.token !== params.token) return undefined;
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

export function reportRunStopFailure(params: {
  itemID: number;
  engine: EngineMode;
  token: ReaderRunToken;
  rawError: string;
}): RunProgressState | undefined {
  const current = getRunProgressState(params.itemID);
  if (!current || current.token !== params.token) return undefined;
  const failure = {
    kind: "unknown" as const,
    engine: params.engine,
    userMessage: `${getEngineLabel(params.engine)} could not be stopped. Try Cancel again before starting or changing sessions.`,
    rawError: params.rawError,
  };
  const next = {
    ...current,
    updatedAt: Date.now(),
    failure,
    canRetry: false,
  };
  setRunProgressState(next);
  notifyReaderPaneStateChanged(params.itemID);
  return next;
}

export function recoverLatePreparedRunStopFailure(params: {
  itemID: number;
  engine: EngineMode;
  token: ReaderRunToken;
  processId?: string;
  rawError: string;
}): RunProgressState | undefined {
  const pending = getPendingEngineCompletion(params.itemID);
  const current = getRunProgressState(params.itemID);
  if (
    !pending ||
    pending.token !== params.token ||
    !current ||
    current.token !== params.token
  ) {
    return undefined;
  }

  pending.terminalClaim = undefined;
  pending.terminalSettled = false;
  pending.preparationSettled = true;
  restoreReaderRunOwnership(params.itemID, params.engine, params.token);

  const next: RunProgressState = {
    ...current,
    phase: "running",
    updatedAt: Date.now(),
    processId: params.processId,
    failure: {
      kind: "unknown",
      engine: params.engine,
      userMessage: `${getEngineLabel(params.engine)} could not be stopped. Try Cancel again or restart Zotero before starting or changing sessions.`,
      rawError: params.rawError,
    },
    canRetry: false,
  };
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
  token: ReaderRunToken;
  rawError: string;
  source: RunFailureSource;
  suppressMessage?: boolean;
}) {
  const state = failRunProgress({
    ...params,
    canRetry: !params.suppressMessage,
  });
  const failure =
    state?.failure ??
    classifyRunFailure({
      engine: params.engine,
      rawError: params.rawError,
      source: params.source,
    });
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
