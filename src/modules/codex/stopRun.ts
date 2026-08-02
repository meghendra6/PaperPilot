import {
  finishReaderRunsForMode,
  getActiveReaderRunMode,
} from "../ai/runPresentation";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { clearCodexPollerForItem } from "./poller";
import { clearCodexRunStateForItem } from "./runState";

declare const addon: any;
declare const Zotero: any;

export async function stopCodexRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
  finishPresentation?: boolean;
}) {
  const runState = addon.data.codexRunStates?.get(params.itemID);
  const shouldStopProcess = Boolean(
    addon.data.codexRunPollers?.has(params.itemID) ||
      runState?.runStatus === "running" ||
      (runState && getActiveReaderRunMode(params.itemID) === "codex_cli"),
  );
  clearCodexPollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "codex_cli");
  }
  const pid = shouldStopProcess ? runState?.processId : undefined;
  await stopDetachedRunProcess(pid, {
    requireProcessId: shouldStopProcess,
  });
  if (runState && params.clearRunState !== false) {
    clearCodexRunStateForItem(params.itemID);
  }
  return runState;
}
