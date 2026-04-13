import { clearGeminiPollerForItem } from "./poller";
import { clearGeminiRunStateForItem } from "./runState";

declare const addon: any;
declare const Zotero: any;

export async function stopGeminiRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
}) {
  const runState = addon.data.geminiRunStates?.get(params.itemID);
  clearGeminiPollerForItem(params.itemID);
  const pid = runState?.processId;
  if (pid) {
    await Zotero.Utilities.Internal.exec("/bin/zsh", [
      "-lc",
      `kill ${pid} >/dev/null 2>&1 || true`,
    ]);
  }
  if (runState && params.clearRunState !== false) {
    clearGeminiRunStateForItem(params.itemID);
  }
  return runState;
}
