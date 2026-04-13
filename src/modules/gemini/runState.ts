declare const addon: any;

export interface GeminiRunState {
  processId?: string;
}

export function setGeminiRunStateForItem(itemID: number, state: GeminiRunState) {
  addon.data.geminiRunStates?.set(itemID, state);
}

export function clearGeminiRunStateForItem(itemID: number) {
  addon.data.geminiRunStates?.delete(itemID);
}
