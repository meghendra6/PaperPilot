import { stopClaudeRunSilently } from "../claude/stopRun";
import { stopCodexRunSilently } from "../codex/stopRun";
import { stopGeminiRunSilently } from "../gemini/stopRun";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { finishRunAfterCleanup } from "./runCompletion";
import {
  advanceRunProgress,
  claimPendingEngineCompletion,
  getPendingEngineCompletion,
  markPendingEngineTerminalSettled,
  releasePendingEngineCompletionClaim,
  reportRunStopFailure,
} from "./runLifecycle";
import { markReaderRunFinished } from "./runPresentation";

export async function cancelActiveEngineRun(itemID: number): Promise<boolean> {
  const pending = getPendingEngineCompletion(itemID);
  if (!pending) return false;
  if (!claimPendingEngineCompletion(itemID, pending.token, "cancel")) {
    return false;
  }

  const workspacePath = pending.workspacePath;

  try {
    if (pending.mode === "claude_code") {
      await stopClaudeRunSilently({ itemID, finishPresentation: false });
    } else if (pending.mode === "gemini_cli") {
      await stopGeminiRunSilently({ itemID, finishPresentation: false });
    } else {
      await stopCodexRunSilently({ itemID, finishPresentation: false });
    }
  } catch (error) {
    releasePendingEngineCompletionClaim(itemID, pending.token, "cancel");
    const detail = error instanceof Error ? error.message : String(error);
    reportRunStopFailure({
      itemID,
      engine: pending.mode,
      token: pending.token,
      rawError: `Paper Pilot could not confirm process termination: ${detail}`,
    });
    return false;
  }

  pending.cancelTimeout?.();
  pending.cleanupClaimed = Boolean(workspacePath);
  advanceRunProgress(itemID, pending.token, {
    type: "cancelled",
    canRetry: pending.retryable,
  });
  markReaderRunFinished(itemID, pending.token);

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
        workspacePath ? cleanupWorkspaceIfEnabled(workspacePath) : undefined,
      complete: completeCancellation,
      incomplete: completeCancellation,
      finalize: () => markPendingEngineTerminalSettled(itemID, pending.token),
    });
  } catch {
    // The failure callback has already released any silent workflow state.
  }
  return true;
}
