export const WORKBENCH_WAIT_FOR_ANSWER =
  "Wait for the current answer to finish.";
export const WORKBENCH_WAIT_FOR_DISCOVERY =
  "Wait for the prior-work search to finish.";
export const WORKBENCH_WAIT_FOR_HIGHLIGHTING =
  "Wait for highlighting to finish.";

export interface WorkbenchBusySignals {
  /** A Workbench card request of this paper is running. */
  ownRunActive: boolean;
  /** Any engine run, admission, or workspace task holds this paper. */
  readerBusy: boolean;
  discoveryRunning?: boolean;
  highlightRunning?: boolean;
}

export type WorkbenchActionBlock =
  | { blocked: false }
  | { blocked: true; reason?: string };

/**
 * Workbench requests share the paper's single engine slot with chat. Block
 * them while that slot is taken and say why, instead of dropping the click.
 */
export function getWorkbenchActionBlock(
  signals: WorkbenchBusySignals,
): WorkbenchActionBlock {
  if (signals.ownRunActive) return { blocked: true };
  if (!signals.readerBusy) return { blocked: false };
  if (signals.discoveryRunning) {
    return { blocked: true, reason: WORKBENCH_WAIT_FOR_DISCOVERY };
  }
  if (signals.highlightRunning) {
    return { blocked: true, reason: WORKBENCH_WAIT_FOR_HIGHLIGHTING };
  }
  return { blocked: true, reason: WORKBENCH_WAIT_FOR_ANSWER };
}

function formatCardCount(count: number) {
  return count === 1 ? "1 card" : `${count} cards`;
}

export function formatClearedCardsStatus(count: number): string {
  return `Cleared ${formatCardCount(count)}`;
}

export function buildClearCardsConfirmation(count: number): {
  title: string;
  message: string;
} {
  return {
    title: "Clear Workbench cards?",
    message: `This removes ${formatCardCount(count)} from this session. Notes you already saved in Zotero stay unchanged. You cannot undo this.`,
  };
}
