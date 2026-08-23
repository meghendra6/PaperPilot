import type { EngineMode } from "./types";
import type { RunProfile } from "./runProfile";
import type { StructuredOutputSchema } from "./structuredOutput";
import { isClaudeRunActiveForItem } from "../claude/runState";
import { isCodexRunActiveForItem } from "../codex/runState";
import { isGeminiRunActiveForItem } from "../gemini/runState";
import { cleanupPaperWorkspaceForItemIfEnabled } from "../workspace/cleanup";
import {
  claimDirectWorkspaceRun,
  getPendingEngineCompletion,
  isDirectWorkspaceRunClaimed,
  isDirectWorkspaceRunClaimCurrent,
  isReaderLifecycleClaimActive,
  releaseDirectWorkspaceRun,
} from "./runLifecycle";
import { stopDetachedRunProcess } from "./runCompletion";

export interface WorkspaceRunResult {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  processId?: string;
}

export interface FailedWorkspaceRun {
  ok: false;
  workspacePath: string;
  promptPreview: string;
  error: string;
}

export interface WorkspaceRunProgress {
  rawOutput: string;
  parsedOutput: string;
  completed: boolean;
  exitCode: string;
}

export function getWorkspaceEngineLabel(mode: EngineMode) {
  if (mode === "claude_code") {
    return "Claude Code";
  }
  if (mode === "gemini_cli") {
    return "Gemini CLI";
  }
  return "Codex CLI";
}

export function getWorkspaceEngineActiveMessage(
  mode: EngineMode,
  taskLabel: string,
) {
  return `A ${getWorkspaceEngineLabel(mode)} run is already active for this paper. Wait for it to finish before starting ${taskLabel}.`;
}

export function isWorkspaceRunActiveForItem(mode: EngineMode, itemID: number) {
  if (
    isReaderLifecycleClaimActive(itemID) ||
    getPendingEngineCompletion(itemID)
  ) {
    return true;
  }
  if (mode === "claude_code") {
    return isClaudeRunActiveForItem(itemID);
  }
  if (mode === "gemini_cli") {
    return isGeminiRunActiveForItem(itemID);
  }
  return isCodexRunActiveForItem(itemID);
}

export function claimWorkspaceRunReservation(
  mode: EngineMode,
  itemID: number,
): symbol | undefined {
  if (isWorkspaceRunActiveForItem(mode, itemID)) return undefined;
  return claimDirectWorkspaceRun(itemID);
}

export function releaseWorkspaceRunReservation(
  itemID: number,
  token: symbol,
): void {
  releaseDirectWorkspaceRun(itemID, token);
}

export function isWorkspaceRunReservedForItem(itemID: number): boolean {
  return isDirectWorkspaceRunClaimed(itemID);
}

export async function startWorkspaceTextRun(params: {
  mode: EngineMode;
  itemID: number;
  reservationItemID: number;
  reservationToken: symbol;
  title: string;
  sessionId: string;
  question: string;
  profile: Exclude<RunProfile, "chat">;
  outputSchema?: StructuredOutputSchema;
  requiredDiscoveryCapabilities?: import("../discovery/types").DiscoveryCapabilities;
  signal?: AbortSignal;
  deadline?: number;
  onDeferredCleanup?: (cleanup: Promise<void>) => void;
  prepareRun?: () => Promise<WorkspaceRunResult | FailedWorkspaceRun>;
}): Promise<WorkspaceRunResult | FailedWorkspaceRun> {
  if (
    !isDirectWorkspaceRunClaimCurrent(
      params.reservationItemID,
      params.reservationToken,
    )
  ) {
    throw new Error(
      getWorkspaceEngineActiveMessage(params.mode, "this workspace task"),
    );
  }

  const interruptionMessage = () =>
    params.signal?.aborted
      ? "Workspace run preparation cancelled."
      : "Workspace run preparation timed out.";
  if (params.signal?.aborted) throw new Error(interruptionMessage());
  if (params.deadline !== undefined && Date.now() >= params.deadline) {
    throw new Error(interruptionMessage());
  }

  const prepare = async () => {
    let result: WorkspaceRunResult | FailedWorkspaceRun;
    if (params.mode === "claude_code") {
      const { startClaudeRunForQuestion } = await import("../claude/runner");
      result = await startClaudeRunForQuestion({
        itemID: params.itemID,
        title: params.title,
        sessionId: params.sessionId,
        question: params.question,
        profile: params.profile,
        outputSchema: params.outputSchema,
      });
    } else if (params.mode === "gemini_cli") {
      const { startGeminiRunForQuestion } = await import("../gemini/runner");
      result = await startGeminiRunForQuestion({
        itemID: params.itemID,
        title: params.title,
        sessionId: params.sessionId,
        question: params.question,
        profile: params.profile,
        outputSchema: params.outputSchema,
      });
    } else {
      if (
        params.requiredDiscoveryCapabilities &&
        params.requiredDiscoveryCapabilities.agentWebSearch !== true
      ) {
        throw new Error(
          "The admitted discovery run no longer has a verified web-search capability.",
        );
      }
      const { startCodexRunForQuestion } = await import("../codex/runner");
      result = await startCodexRunForQuestion({
        itemID: params.itemID,
        title: params.title,
        sessionId: params.sessionId,
        question: params.question,
        useResume: false,
        webSearchEnabledOverride: params.requiredDiscoveryCapabilities
          ? true
          : undefined,
        profile: params.profile,
        outputSchema: params.outputSchema,
      });
    }

    return result;
  };
  const preparation = (params.prepareRun || prepare)();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    const rejectInterrupted = () => reject(new Error(interruptionMessage()));
    if (params.signal) {
      abortListener = rejectInterrupted;
      params.signal.addEventListener("abort", abortListener, { once: true });
    }
    if (params.deadline !== undefined) {
      timer = setTimeout(
        rejectInterrupted,
        Math.max(0, params.deadline - Date.now()),
      );
    }
  });

  try {
    return await (params.signal || params.deadline !== undefined
      ? Promise.race([preparation, interrupted])
      : preparation);
  } catch (error) {
    const wasInterrupted =
      params.signal?.aborted ||
      (params.deadline !== undefined && Date.now() >= params.deadline);
    if (wasInterrupted) {
      const deferredCleanup = preparation.then(
        async (result) => {
          if (result.ok) {
            await stopDetachedRunProcess(result.processId, {
              requireProcessId: true,
            });
          }
          await cleanupPaperWorkspaceForItemIfEnabled({
            itemID: params.itemID,
            title: params.title,
            profile: params.profile,
          });
        },
        async () => {
          await cleanupPaperWorkspaceForItemIfEnabled({
            itemID: params.itemID,
            title: params.title,
            profile: params.profile,
          });
        },
      );
      if (params.onDeferredCleanup) {
        params.onDeferredCleanup(deferredCleanup);
      } else {
        await deferredCleanup;
      }
    } else {
      await cleanupPaperWorkspaceForItemIfEnabled({
        itemID: params.itemID,
        title: params.title,
        profile: params.profile,
      });
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (params.signal && abortListener) {
      params.signal.removeEventListener("abort", abortListener);
    }
  }
}

export async function readWorkspaceRunProgress(
  mode: EngineMode,
  paths: {
    outputPath: string;
    stderrPath: string;
    exitCodePath: string;
  },
): Promise<WorkspaceRunProgress> {
  if (mode === "claude_code") {
    const { readClaudeRunProgress } = await import("../claude/runner");
    return readClaudeRunProgress(paths);
  }

  if (mode === "gemini_cli") {
    const { readGeminiRunProgress } = await import("../gemini/runner");
    return readGeminiRunProgress(paths);
  }

  const { readCodexRunProgress } = await import("../codex/runner");
  return readCodexRunProgress(paths);
}

export function extractWorkspaceRunText(
  _mode: EngineMode,
  progress: Pick<
    WorkspaceRunProgress,
    "rawOutput" | "parsedOutput" | "exitCode"
  >,
) {
  return progress.parsedOutput;
}
