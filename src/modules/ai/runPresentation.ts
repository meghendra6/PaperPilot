import type { EngineMode } from "./types";

export type ReaderRunEvent =
  | { type: "started"; itemID: number; mode: EngineMode }
  | { type: "finished"; itemID: number; mode: EngineMode }
  | { type: "state_changed"; itemID: number };

export type ReaderRunToken = symbol;

type ActiveRun = {
  mode: EngineMode;
  token: ReaderRunToken;
};

const activeRunsByItem = new Map<number, ActiveRun[]>();
const listenersByItem = new Map<number, Set<(event: ReaderRunEvent) => void>>();

function emit(event: ReaderRunEvent) {
  for (const listener of listenersByItem.get(event.itemID) ?? []) {
    listener(event);
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

export function getActiveReaderRunMode(itemID: number): EngineMode | undefined {
  return activeRunsByItem.get(itemID)?.at(-1)?.mode;
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
