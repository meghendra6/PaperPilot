import { clearCodexPollerForItem } from "./poller";
import { clearCodexRunStateForItem } from "./runState";

declare const addon: any;
declare const Zotero: any;

export async function stopCodexRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
}) {
  const runState = addon.data.codexRunStates?.get(params.itemID);
  clearCodexPollerForItem(params.itemID);
  const pid = runState?.processId;
  if (pid) {
    await Zotero.Utilities.Internal.exec("/bin/zsh", [
      "-lc",
      `kill ${pid} >/dev/null 2>&1 || true`,
    ]);
  }
  if (runState && params.clearRunState !== false) {
    clearCodexRunStateForItem(params.itemID);
  }
  return runState;
}
