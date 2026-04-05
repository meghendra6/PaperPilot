import type { AutoHighlightResult } from "./types";

export function shouldEnableAutoHighlight(isPDF: boolean, isRunning: boolean) {
  return isPDF && !isRunning;
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
