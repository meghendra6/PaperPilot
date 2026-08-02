import { stopClaudeRunSilently } from "../claude/stopRun";
import { stopCodexRunSilently } from "../codex/stopRun";
import { stopGeminiRunSilently } from "../gemini/stopRun";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { finishRunAfterCleanup } from "./runCompletion";
import {
  advanceRunProgress,
  clearPendingEngineCompletion,
  getPendingEngineCompletion,
} from "./runLifecycle";

export async function cancelActiveEngineRun(itemID: number): Promise<boolean> {
  const pending = getPendingEngineCompletion(itemID);
  if (!pending) return false;

  pending.cancelTimeout?.();

  try {
    if (pending.mode === "claude_code") {
      await stopClaudeRunSilently({ itemID });
    } else if (pending.mode === "gemini_cli") {
      await stopGeminiRunSilently({ itemID });
    } else {
      await stopCodexRunSilently({ itemID });
    }
  } catch {
    // Continue releasing UI/workflow state even if process termination fails.
  }
  advanceRunProgress(itemID, {
    type: "cancelled",
    canRetry: pending.retryable,
  });

  const completeCancellation = () =>
    pending.onComplete?.({
      success: false,
      assistantText: `${
        pending.mode === "claude_code"
          ? "Claude Code"
          : pending.mode === "gemini_cli"
            ? "Gemini CLI"
            : "Codex CLI"
      } run cancelled.`,
    });

  try {
    await finishRunAfterCleanup({
      prepare: () => undefined,
      cleanup: () =>
        pending.workspacePath
          ? cleanupWorkspaceIfEnabled(pending.workspacePath)
          : undefined,
      complete: completeCancellation,
      incomplete: completeCancellation,
      finalize: () => clearPendingEngineCompletion(itemID, pending.token),
    });
  } catch {
    // The failure callback has already released any silent workflow state.
  }
  return true;
}
