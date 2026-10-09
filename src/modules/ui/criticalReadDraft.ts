import type { CriticalReadStepID } from "../criticalRead/types";

/**
 * Memory-only Critical Read view state. Status updates rebuild the whole
 * section, so unsent reader input and expanded completed steps live here,
 * keyed by paper, Paper Pilot session, and step. Nothing here is persisted.
 */
interface CriticalReadViewState {
  drafts: Map<CriticalReadStepID, string>;
  expanded: Set<CriticalReadStepID>;
}

const views = new Map<string, CriticalReadViewState>();

function viewKey(itemID: number, sessionID: string | undefined) {
  return `${itemID}:${sessionID ?? ""}`;
}

function viewState(itemID: number, sessionID: string | undefined) {
  const key = viewKey(itemID, sessionID);
  let current = views.get(key);
  if (!current) {
    current = { drafts: new Map(), expanded: new Set() };
    views.set(key, current);
  }
  return current;
}

/** Returns undefined when the reader has not typed anything for this step. */
export function getCriticalReadDraft(
  itemID: number,
  sessionID: string | undefined,
  stepID: CriticalReadStepID,
): string | undefined {
  return views.get(viewKey(itemID, sessionID))?.drafts.get(stepID);
}

/** Records the textarea value, including an intentionally emptied draft. */
export function setCriticalReadDraft(
  itemID: number,
  sessionID: string | undefined,
  stepID: CriticalReadStepID,
  text: string,
): void {
  viewState(itemID, sessionID).drafts.set(stepID, text);
}

/** Drops drafts for steps whose input is now saved in the workflow state. */
export function pruneCriticalReadDrafts(
  itemID: number,
  sessionID: string | undefined,
  completedStepIDs: readonly CriticalReadStepID[],
): void {
  const current = views.get(viewKey(itemID, sessionID));
  if (!current) return;
  for (const stepID of completedStepIDs) current.drafts.delete(stepID);
}

export function getExpandedCriticalReadSteps(
  itemID: number,
  sessionID: string | undefined,
): CriticalReadStepID[] {
  return [...(views.get(viewKey(itemID, sessionID))?.expanded ?? [])];
}

export function setCriticalReadStepExpanded(
  itemID: number,
  sessionID: string | undefined,
  stepID: CriticalReadStepID,
  expanded: boolean,
): void {
  const current = viewState(itemID, sessionID);
  if (expanded) current.expanded.add(stepID);
  else current.expanded.delete(stepID);
}

/** Forgets the view state of one paper session, or of every paper. */
export function clearCriticalReadViewState(
  itemID?: number,
  sessionID?: string,
): void {
  if (itemID === undefined) {
    views.clear();
    return;
  }
  if (sessionID !== undefined) {
    views.delete(viewKey(itemID, sessionID));
    return;
  }
  for (const key of [...views.keys()]) {
    if (key.startsWith(`${itemID}:`)) views.delete(key);
  }
}
