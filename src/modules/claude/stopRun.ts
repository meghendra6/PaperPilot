import { clearClaudePollerForItem } from "./poller";
import { clearClaudeRunStateForItem } from "./runState";

declare const addon: any;
declare const Zotero: any;

export async function stopClaudeRunSilently(params: {
  itemID: number;
  clearRunState?: boolean;
}) {
  const runState = addon.data.claudeRunStates?.get(params.itemID);
  clearClaudePollerForItem(params.itemID);
  const pid = runState?.processId;
  if (pid) {
    await Zotero.Utilities.Internal.exec("/bin/zsh", [
      "-lc",
      `kill ${pid} >/dev/null 2>&1 || true`,
    ]);
  }
  if (runState && params.clearRunState !== false) {
    clearClaudeRunStateForItem(params.itemID);
  }
  return runState;
}
