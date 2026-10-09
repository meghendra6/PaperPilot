export const DISCOVERY_ALREADY_RUNNING_MESSAGE =
  "Discovery is already running. Wait for it to finish or cancel it first.";

export interface DiscoveryButtonPresentation {
  label: string;
  disabled: boolean;
  /** Tooltip and inline note. Empty when the button is usable. */
  note: string;
}

/**
 * The pane button doubles as Cancel while discovery or review insights run.
 * When the engine cannot run discovery it stays a disabled start button with
 * the reason shown next to it.
 */
export function getDiscoveryButtonPresentation(params: {
  reviewInsightRunning: boolean;
  running: boolean;
  hasResults: boolean;
  unavailableReason?: string;
}): DiscoveryButtonPresentation {
  if (params.reviewInsightRunning) {
    return { label: "Cancel review insights", disabled: false, note: "" };
  }
  if (params.running) {
    return { label: "Cancel discovery", disabled: false, note: "" };
  }
  const label = params.hasResults
    ? "Refresh verified prior work"
    : "Find verified prior work";
  if (params.unavailableReason) {
    return { label, disabled: true, note: params.unavailableReason };
  }
  return { label, disabled: false, note: "" };
}

export type DiscoveryRequestDecision =
  | { action: "start" }
  | { action: "already_running"; message: string }
  | { action: "unavailable"; message: string };

/**
 * Decides what a programmatic "Find prior work" request does. It never
 * toggles a running search into cancellation.
 */
export function resolveDiscoveryRequest(params: {
  running: boolean;
  unavailableReason?: string;
}): DiscoveryRequestDecision {
  if (params.running) {
    return {
      action: "already_running",
      message: DISCOVERY_ALREADY_RUNNING_MESSAGE,
    };
  }
  if (params.unavailableReason) {
    return { action: "unavailable", message: params.unavailableReason };
  }
  return { action: "start" };
}
