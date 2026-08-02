import { finishReaderRunsForMode } from "../ai/runPresentation";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { clearGeminiPollerForItem } from "./poller";
import { clearGeminiRunStateForItem } from "./runState";

declare const addon: any;
declare const Zotero: any;

export async function stopGeminiRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
  finishPresentation?: boolean;
}) {
  const runState = addon.data.geminiRunStates?.get(params.itemID);
  clearGeminiPollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "gemini_cli");
  }
  const pid = runState?.processId;
  try {
    await stopDetachedRunProcess(pid);
  } finally {
    if (runState && params.clearRunState !== false) {
      clearGeminiRunStateForItem(params.itemID);
    }
  }
  return runState;
}
