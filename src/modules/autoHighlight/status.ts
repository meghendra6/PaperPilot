import type { AutoHighlightResult } from "./types";

export const AUTO_HIGHLIGHT_CANCELLED_STATUS = "Highlighting cancelled";

/** Names the highlights a cancelled run saved but could not erase. */
export function describeKeptHighlights(keptHighlights: number): string {
  const noun = keptHighlights === 1 ? "highlight" : "highlights";
  return `${keptHighlights} ${noun} could not be removed.`;
}

export function formatAutoHighlightCancelledStatus(keptHighlights = 0): string {
  return keptHighlights > 0
    ? `${AUTO_HIGHLIGHT_CANCELLED_STATUS}. ${describeKeptHighlights(keptHighlights)}`
    : AUTO_HIGHLIGHT_CANCELLED_STATUS;
}

export interface AutoHighlightButtonPresentation {
  label: string;
  disabled: boolean;
  /** What a click does in this state. */
  action: "start" | "cancel" | "none";
}

/** The button turns into Cancel while highlighting runs, like discovery. */
export function getAutoHighlightButtonPresentation(state: {
  running: boolean;
  cancelling?: boolean;
}): AutoHighlightButtonPresentation {
  if (state.running && state.cancelling) {
    return {
      label: "Cancelling highlighting…",
      disabled: true,
      action: "none",
    };
  }
  if (state.running) {
    return { label: "Cancel highlighting", disabled: false, action: "cancel" };
  }
  return { label: "Highlight key passages", disabled: false, action: "start" };
}

export function formatAutoHighlightSummary(result: AutoHighlightResult) {
  if (result.created > 0 && result.unmatched === 0) {
    return result.skipped > 0
      ? `Created ${result.created} highlights, skipped ${result.skipped} duplicates.`
      : `Created ${result.created} highlights.`;
  }

  if (result.created > 0 || result.skipped > 0) {
    return `Created ${result.created} highlights, skipped ${result.skipped}, unmatched ${result.unmatched}.`;
  }

  return `No highlights created. ${result.unmatched} quotes could not be matched.`;
}
