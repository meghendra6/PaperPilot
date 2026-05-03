declare const addon: any;

export interface GeminiRunState {
  processId?: string;
}

export function setGeminiRunStateForItem(
  itemID: number,
  state: GeminiRunState,
) {
  addon.data.geminiRunStates?.set(itemID, state);
}

export function getGeminiRunStateForItem(itemID: number) {
  return addon.data.geminiRunStates?.get(itemID);
}

export function isGeminiRunActiveForItem(itemID: number) {
  return Boolean(
    addon.data.geminiRunPollers?.has(itemID) ||
      getGeminiRunStateForItem(itemID)?.processId,
  );
}

export function clearGeminiRunStateForItem(itemID: number) {
  addon.data.geminiRunStates?.delete(itemID);
}
