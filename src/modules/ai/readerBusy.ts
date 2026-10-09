import {
  getPendingEngineCompletion,
  isReaderLifecycleClaimActive,
} from "./runLifecycle";
import { getActiveReaderRunMode } from "./runPresentation";

/**
 * True while this paper's engine slot is taken: a chat or Workbench answer,
 * its admission or cleanup, a session change, or a workspace task such as
 * discovery or highlighting.
 */
export function isReaderChatBusy(itemID: number): boolean {
  return Boolean(
    getActiveReaderRunMode(itemID) ||
      getPendingEngineCompletion(itemID) ||
      isReaderLifecycleClaimActive(itemID),
  );
}
