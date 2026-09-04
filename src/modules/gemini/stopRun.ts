import {
  finishReaderRunsForMode,
  getActiveReaderRunMode,
} from "../ai/runPresentation";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { clearGeminiPollerForItem } from "./poller";
import { clearGeminiRunStateForItem } from "./runState";

declare const addon: any;

export async function stopGeminiRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
  finishPresentation?: boolean;
}) {
  const runState = addon.data.geminiRunStates?.get(params.itemID);
  const shouldStopProcess = Boolean(
    addon.data.geminiRunPollers?.has(params.itemID) ||
      (runState && getActiveReaderRunMode(params.itemID) === "gemini_cli"),
  );
  const pid = shouldStopProcess ? runState?.processId : undefined;
  await stopDetachedRunProcess(pid, { requireProcessId: shouldStopProcess });
  clearGeminiPollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "gemini_cli");
  }
  if (runState && params.clearRunState !== false) {
    clearGeminiRunStateForItem(params.itemID);
  }
  return runState;
}
