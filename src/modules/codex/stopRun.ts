import {
  finishReaderRunsForMode,
  getActiveReaderRunMode,
} from "../ai/runPresentation";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { clearCodexPollerForItem } from "./poller";
import { clearCodexRunStateForItem } from "./runState";

declare const addon: any;

export async function stopCodexRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
  finishPresentation?: boolean;
}) {
  const runState = addon.data.codexRunStates?.get(params.itemID);
  // A completed or failed state is left over from an earlier run on this
  // paper. It proves no process belongs to the run that is preparing now.
  const isTerminalState =
    runState?.runStatus === "completed" ||
    runState?.runStatus === "error" ||
    runState?.runStatus === "cancelled";
  const shouldStopProcess = Boolean(
    addon.data.codexRunPollers?.has(params.itemID) ||
      runState?.runStatus === "running" ||
      (runState &&
        !isTerminalState &&
        getActiveReaderRunMode(params.itemID) === "codex_cli"),
  );
  const pid = shouldStopProcess ? runState?.processId : undefined;
  await stopDetachedRunProcess(pid, {
    requireProcessId: shouldStopProcess,
  });
  clearCodexPollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "codex_cli");
  }
  if (runState && params.clearRunState !== false) {
    clearCodexRunStateForItem(params.itemID);
  }
  return runState;
}
