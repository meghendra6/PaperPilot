import { finishReaderRunsForMode } from "../ai/runPresentation";
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
  clearCodexPollerForItem(params.itemID);
  if (params.finishPresentation !== false) {
    finishReaderRunsForMode(params.itemID, "codex_cli");
  }
  const pid = runState?.processId;
  await stopDetachedRunProcess(pid);
  if (runState && params.clearRunState !== false) {
    clearCodexRunStateForItem(params.itemID);
  }
  return runState;
}
