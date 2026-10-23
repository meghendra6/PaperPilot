import { logWithToolkit } from "../../utils/addonScope";
import type { EngineMode } from "./types";

export type ReaderRunEvent =
  | { type: "started"; itemID: number; mode: EngineMode }
  | { type: "finished"; itemID: number; mode: EngineMode }
  | { type: "state_changed"; itemID: number };

export type ReaderRunToken = symbol;

export type ReaderRunCompletionResult = {
  timings?: import("../context/requestContext").RunTimings;
  requestContext?: import("../context/requestContext").RequestContextSnapshot;
  success: boolean;
  assistantText: string;
  continuationToken?: ReaderRunToken;
};

type ActiveRun = {
  mode: EngineMode;
  token: ReaderRunToken;
};

const activeRunsByItem = new Map<number, ActiveRun[]>();
const listenersByItem = new Map<number, Set<(event: ReaderRunEvent) => void>>();

// Events fire in the middle of lifecycle mutations. A listener that throws
// must not skip the bookkeeping that follows, or the paper stays busy.
function emit(event: ReaderRunEvent) {
  for (const listener of listenersByItem.get(event.itemID) ?? []) {
    try {
      listener(event);
    } catch (error) {
      logWithToolkit("Paper Pilot run event listener failed:", error);
    }
  }
}

export function markReaderRunStarted(
  itemID: number,
  mode: EngineMode,
): ReaderRunToken {
  const token = Symbol(`${itemID}:${mode}`);
  const runs = activeRunsByItem.get(itemID) ?? [];
  runs.push({ mode, token });
  activeRunsByItem.set(itemID, runs);
  emit({ type: "started", itemID, mode });
  return token;
}

export function markReaderRunFinished(
  itemID: number,
  token: ReaderRunToken,
): void {
  const runs = activeRunsByItem.get(itemID);
  const run = runs?.find((candidate) => candidate.token === token);
  if (!runs || !run) return;

  const remaining = runs.filter((candidate) => candidate.token !== token);
  if (remaining.length) {
    activeRunsByItem.set(itemID, remaining);
  } else {
    activeRunsByItem.delete(itemID);
  }
  emit({ type: "finished", itemID, mode: run.mode });
}

export function restoreReaderRunOwnership(
  itemID: number,
  mode: EngineMode,
  token: ReaderRunToken,
): void {
  const runs = activeRunsByItem.get(itemID) ?? [];
  if (runs.some((candidate) => candidate.token === token)) return;
  runs.push({ mode, token });
  activeRunsByItem.set(itemID, runs);
  emit({ type: "started", itemID, mode });
}

export function finishReaderRunsForMode(
  itemID: number,
  mode: EngineMode,
): void {
  const runs = activeRunsByItem.get(itemID);
  if (!runs?.some((run) => run.mode === mode)) return;

  const remaining = runs.filter((run) => run.mode !== mode);
  if (remaining.length) {
    activeRunsByItem.set(itemID, remaining);
  } else {
    activeRunsByItem.delete(itemID);
  }
  emit({ type: "finished", itemID, mode });
}

/**
 * Ends every active run token. Add-on shutdown calls this after it has
 * collected the runs to stop, so a run that is still preparing sees its
 * token revoked and stops the process it launches instead of polling it.
 */
export function finishAllReaderRuns(): void {
  const finished = [...activeRunsByItem].flatMap(([itemID, runs]) =>
    runs.map((run) => ({ itemID, mode: run.mode })),
  );
  activeRunsByItem.clear();
  for (const run of finished) emit({ type: "finished", ...run });
}

export function getActiveReaderRunMode(itemID: number): EngineMode | undefined {
  return activeRunsByItem.get(itemID)?.at(-1)?.mode;
}

export function listActiveReaderRuns(): Array<{
  itemID: number;
  mode: EngineMode;
}> {
  return [...activeRunsByItem].flatMap(([itemID, runs]) =>
    runs.map((run) => ({ itemID, mode: run.mode })),
  );
}

export function isReaderRunTokenActive(
  itemID: number,
  token: ReaderRunToken,
): boolean {
  return Boolean(
    activeRunsByItem
      .get(itemID)
      ?.some((candidate) => candidate.token === token),
  );
}

export function notifyReaderPaneStateChanged(itemID: number): void {
  emit({ type: "state_changed", itemID });
}

export function subscribeToReaderRunEvents(
  itemID: number,
  listener: (event: ReaderRunEvent) => void,
): () => void {
  const listeners = listenersByItem.get(itemID) ?? new Set();
  listeners.add(listener);
  listenersByItem.set(itemID, listeners);

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
    if (!listeners.size) listenersByItem.delete(itemID);
  };
}
