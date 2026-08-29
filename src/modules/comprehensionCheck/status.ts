import type { ComprehensionCheckState } from "./types";

export function getMasteryState(
  itemID: number,
): ComprehensionCheckState | undefined {
  return addon.data.comprehensionCheckStates?.get(itemID);
}

export function getMasteryStateForSession(
  itemID: number,
  sessionID: string | undefined,
): ComprehensionCheckState | undefined {
  const current = getMasteryState(itemID);
  if (!current) return undefined;
  return sessionID === undefined || current.sessionID === sessionID
    ? current
    : undefined;
}

export function setMasteryState(
  itemID: number,
  state: ComprehensionCheckState,
): void {
  if (!addon.data.comprehensionCheckStates) {
    addon.data.comprehensionCheckStates = new Map();
  }
  const previous = addon.data.comprehensionCheckStates.get(itemID);
  const timestamp = new Date().toISOString();
  addon.data.comprehensionCheckStates.set(itemID, {
    ...state,
    schemaVersion: 2,
    revision: Math.max(previous?.revision ?? 0, state.revision ?? 0) + 1,
    createdAt: state.createdAt ?? previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

export function clearMasteryState(itemID: number): void {
  addon.data.comprehensionCheckStates?.delete(itemID);
}

export function buildInitialMasteryState(
  options: {
    sessionID?: string;
    sourceSnapshot?: ComprehensionCheckState["sourceSnapshot"];
    now?: Date;
  } = {},
): ComprehensionCheckState {
  const timestamp = (options.now ?? new Date()).toISOString();
  return {
    schemaVersion: 2,
    revision: 0,
    ...(options.sessionID ? { sessionID: options.sessionID } : {}),
    ...(options.sourceSnapshot
      ? { sourceSnapshot: options.sourceSnapshot }
      : {}),
    phase: "idle",
    running: false,
    status: "",
    rounds: [],
    topics: [],
    currentQuestion: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
