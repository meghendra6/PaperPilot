declare const addon: any;

export interface ClaudeRunState {
  processId?: string;
}

export function setClaudeRunStateForItem(
  itemID: number,
  state: ClaudeRunState,
) {
  addon.data.claudeRunStates?.set(itemID, state);
}

export function getClaudeRunStateForItem(itemID: number) {
  return addon.data.claudeRunStates?.get(itemID);
}

export function isClaudeRunActiveForItem(itemID: number) {
  return Boolean(
    addon.data.claudeRunPollers?.has(itemID) ||
      getClaudeRunStateForItem(itemID)?.processId,
  );
}

export function clearClaudeRunStateForItem(itemID: number) {
  addon.data.claudeRunStates?.delete(itemID);
}
