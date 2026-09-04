import {
  finishReaderRunsForMode,
  getActiveReaderRunMode,
} from "../ai/runPresentation";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { clearClaudePollerForItem } from "./poller";
import { clearClaudeRunStateForItem } from "./runState";

declare const addon: any;
declare const Zotero: any;

export async function stopClaudeRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
  finishPresentation?: boolean;
}) {
  const runState = addon.data.claudeRunStates?.get(params.itemID);
  const shouldStopProcess = Boolean(
    addon.data.claudeRunPollers?.has(params.itemID) ||
      (runState && getActiveReaderRunMode(params.itemID) === "claude_code"),
  );
  const pid = shouldStopProcess ? runState?.processId : undefined;
  await stopDetachedRunProcess(pid, { requireProcessId: shouldStopProcess });
  clearClaudePollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "claude_code");
  }
  if (runState && params.clearRunState !== false) {
    clearClaudeRunStateForItem(params.itemID);
  }
  return runState;
}
