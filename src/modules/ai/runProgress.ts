import type { RunFailure } from "./runFailure";
import type { EngineMode } from "./types";

declare const addon: any;

export const RUN_TIMEOUT_MS = 30 * 60 * 1000;

export type RunProgressPhase =
  | "preparing"
  | "running"
  | "finishing"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunProgressState {
  itemID: number;
  engine: EngineMode;
  phase: RunProgressPhase;
  startedAt: number;
  updatedAt: number;
  processId?: string;
  failure?: RunFailure;
  canRetry?: boolean;
}

export type RunProgressEvent =
  | { type: "spawned"; at: number; processId?: string }
  | { type: "finishing"; at: number }
  | { type: "completed"; at: number }
  | { type: "failed"; at: number; failure: RunFailure; canRetry?: boolean }
  | { type: "cancelled"; at: number; canRetry?: boolean };

export function createRunProgressState(params: {
  itemID: number;
  engine: EngineMode;
  now?: number;
}): RunProgressState {
  const now = params.now ?? Date.now();
  return {
    itemID: params.itemID,
    engine: params.engine,
    phase: "preparing",
    startedAt: now,
    updatedAt: now,
  };
}

export function transitionRunProgress(
  state: RunProgressState,
  event: RunProgressEvent,
): RunProgressState {
  if (event.type === "spawned") {
    return {
      ...state,
      phase: "running",
      updatedAt: event.at,
      processId: event.processId,
      failure: undefined,
    };
  }
  if (event.type === "finishing") {
    return { ...state, phase: "finishing", updatedAt: event.at };
  }
  if (event.type === "completed") {
    return {
      ...state,
      phase: "completed",
      updatedAt: event.at,
      failure: undefined,
    };
  }
  if (event.type === "cancelled") {
    return {
      ...state,
      phase: "cancelled",
      updatedAt: event.at,
      canRetry: event.canRetry,
    };
  }
  return {
    ...state,
    phase: "failed",
    updatedAt: event.at,
    failure: event.failure,
    canRetry: event.canRetry,
  };
}

export function isRunProgressActive(state: RunProgressState): boolean {
  return ["preparing", "running", "finishing"].includes(state.phase);
}

export function isRunTimedOut(
  state: RunProgressState,
  now = Date.now(),
): boolean {
  return isRunProgressActive(state) && now - state.startedAt >= RUN_TIMEOUT_MS;
}

export function setRunProgressState(state: RunProgressState): void {
  (addon.data.runProgressStates ??= new Map()).set(state.itemID, state);
}

export function getRunProgressState(
  itemID: number,
): RunProgressState | undefined {
  return addon.data.runProgressStates?.get(itemID);
}

export function updateRunProgressState(
  itemID: number,
  event: RunProgressEvent,
): RunProgressState | undefined {
  const current = getRunProgressState(itemID);
  if (!current) return undefined;
  const next = transitionRunProgress(current, event);
  setRunProgressState(next);
  return next;
}
