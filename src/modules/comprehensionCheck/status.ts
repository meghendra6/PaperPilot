import type { ComprehensionCheckState } from "./types";

export function getMasteryState(
  itemID: number,
): ComprehensionCheckState | undefined {
  return addon.data.comprehensionCheckStates?.get(itemID);
}

export function setMasteryState(
  itemID: number,
  state: ComprehensionCheckState,
): void {
  if (!addon.data.comprehensionCheckStates) {
    addon.data.comprehensionCheckStates = new Map();
  }
  addon.data.comprehensionCheckStates.set(itemID, state);
}

export function clearMasteryState(itemID: number): void {
  addon.data.comprehensionCheckStates?.delete(itemID);
}

export function buildInitialMasteryState(): ComprehensionCheckState {
  return {
    phase: "idle",
    running: false,
    status: "",
    rounds: [],
    topics: [],
    currentQuestion: undefined,
  };
}