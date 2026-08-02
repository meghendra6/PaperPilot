import { finishReaderRunsForMode } from "../ai/runPresentation";
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
  clearClaudePollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "claude_code");
  }
  const pid = runState?.processId;
  try {
    await stopDetachedRunProcess(pid);
  } finally {
    if (runState && params.clearRunState !== false) {
      clearClaudeRunStateForItem(params.itemID);
    }
  }
  return runState;
}
