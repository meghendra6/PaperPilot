import { isClaudeRunActiveForItem } from "../claude/runState";
import { isCodexRunActiveForItem } from "../codex/runState";
import { isGeminiRunActiveForItem } from "../gemini/runState";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import type {
  PrebuiltWorkspaceInput,
  RequestContextSnapshot,
  RunTimings,
} from "../context/requestContext";
import type { WorkspaceSupplementalFiles } from "../workspace/supplementalFiles";
import type { ExecutionSettings } from "./executionSettings";
import { stopDetachedRunProcess } from "./runCompletion";
import {
  claimDirectWorkspaceRun,
  directWorkspaceRunOwner,
  getPendingEngineCompletion,
  isDirectWorkspaceRunClaimCurrent,
  isDirectWorkspaceRunClaimed,
  isReaderLifecycleClaimActive,
  releaseDirectWorkspaceRun,
} from "./runLifecycle";
import type { RunProfile } from "./runProfile";
import type { StructuredOutputSchema } from "./structuredOutput";
import type { EngineMode } from "./types";

export interface WorkspaceRunResult {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  processId?: string;
  requestContext?: RequestContextSnapshot;
  timings?: RunTimings;
}

export interface FailedWorkspaceRun {
  ok: false;
  workspacePath: string;
  promptPreview: string;
  error: string;
}

export interface WorkspaceRunProgress {
  rawOutput: string;
  diagnosticOutput: string;
  parsedOutput: string;
  completed: boolean;
  /** Effective outcome; provider failure cannot be successful OS exit 0. */
  exitCode: string;
  /** Original exit-code file value, retained for diagnostics. */
  processExitCode?: string;
  providerFailed?: boolean;
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

export function releaseReservationAfterConfirmedCleanup(
  cleanup: Promise<void>,
  release: () => void,
  onRejected?: (error: unknown) => void,
) {
  // Rejection means termination or cleanup was not confirmed. Keep the
  // reservation so a second process cannot reuse the same workspace.
  void cleanup.then(release, (error) => onRejected?.(error));
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
  workspaceFiles?: WorkspaceSupplementalFiles;
  prebuiltInput?: PrebuiltWorkspaceInput;
  requestContext?: RequestContextSnapshot;
  executionSettings?: ExecutionSettings;
  requiredDiscoveryCapabilities?: import("../discovery/types").DiscoveryCapabilities;
  signal?: AbortSignal;
  deadline?: number;
  /**
   * Owns late cleanup after cancellation. A rejected promise MUST retain the
   * reservation because process termination was not confirmed.
   */
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

  const owner = directWorkspaceRunOwner(
    params.reservationItemID,
    params.reservationToken,
  );
  if (owner.isShuttingDown()) throw new Error("Paper Pilot is shutting down.");
  const interruptionMessage = () =>
    params.signal?.aborted
      ? "Workspace run preparation cancelled."
      : "Workspace run preparation timed out.";
  if (params.signal?.aborted) throw new Error(interruptionMessage());
  if (params.deadline !== undefined && Date.now() >= params.deadline) {
    throw new Error(interruptionMessage());
  }

  const shouldContinue = () =>
    !owner.isShuttingDown() &&
    isDirectWorkspaceRunClaimCurrent(
      params.reservationItemID,
      params.reservationToken,
    ) &&
    !params.signal?.aborted &&
    (params.deadline === undefined || Date.now() < params.deadline);
  let allocatedPath: string | undefined;
  const onWorkspaceAllocated = (path: string) => {
    allocatedPath = path;
  };
  const cleanupAllocated = () =>
    allocatedPath
      ? cleanupWorkspaceIfEnabled(allocatedPath)
      : Promise.resolve(false);
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
        workspaceFiles: params.workspaceFiles,
        prebuiltInput: params.prebuiltInput,
        requestContext: params.requestContext,
        onWorkspaceAllocated,
        shouldContinue,
        executionSettings: params.executionSettings,
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
        workspaceFiles: params.workspaceFiles,
        prebuiltInput: params.prebuiltInput,
        requestContext: params.requestContext,
        onWorkspaceAllocated,
        shouldContinue,
        executionSettings: params.executionSettings,
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
        workspaceFiles: params.workspaceFiles,
        prebuiltInput: params.prebuiltInput,
        requestContext: params.requestContext,
        onWorkspaceAllocated,
        shouldContinue,
        executionSettings: params.executionSettings,
      });
    }

    return result;
  };
  const preparation = (params.prepareRun || prepare)().then((result) => {
    allocatedPath = result.workspacePath;
    if (result.ok) owner.registerProcess(params.mode, result.processId);
    return result;
  });
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
    const result = await (params.signal || params.deadline !== undefined
      ? Promise.race([preparation, interrupted])
      : preparation);
    if (owner.isShuttingDown())
      throw new Error("Paper Pilot is shutting down.");
    return result;
  } catch (error) {
    const wasInterrupted =
      owner.isShuttingDown() ||
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
          await cleanupAllocated();
        },
        async () => {
          await cleanupAllocated();
        },
      );
      if (params.onDeferredCleanup) {
        params.onDeferredCleanup(deferredCleanup);
      } else {
        await deferredCleanup;
      }
    } else {
      await cleanupAllocated();
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
  let progress: WorkspaceRunProgress;
  if (mode === "claude_code") {
    const { readClaudeRunProgress } = await import("../claude/runner");
    progress = await readClaudeRunProgress(paths);
  } else if (mode === "gemini_cli") {
    const { readGeminiRunProgress } = await import("../gemini/runner");
    progress = await readGeminiRunProgress(paths);
  } else {
    const { readCodexRunProgress } = await import("../codex/runner");
    progress = await readCodexRunProgress(paths);
  }
  // Every non-chat consumer checks this shared outcome before writing artifacts.
  // Keep partial output in raw diagnostics; never expose it as a valid result
  // after the provider rejects the turn or finishes without an assistant answer.
  const invalidSuccess =
    progress.completed &&
    progress.exitCode === "0" &&
    (progress.providerFailed || !progress.parsedOutput.trim());
  return {
    ...progress,
    processExitCode: progress.exitCode,
    ...(invalidSuccess
      ? {
          exitCode: progress.providerFailed
            ? "provider-failed"
            : "empty-output",
          parsedOutput: "",
          diagnosticOutput:
            progress.diagnosticOutput ||
            (progress.providerFailed
              ? "The provider reported a failed turn."
              : "The provider returned no assistant answer."),
        }
      : {}),
  };
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

function waitForWorkspacePoll(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForWorkspaceTextRun(params: {
  mode: EngineMode;
  paths: {
    outputPath: string;
    stderrPath: string;
    exitCodePath: string;
  };
  deadline: number;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}) {
  while (Date.now() < params.deadline) {
    if (params.signal?.aborted) {
      throw new DOMException("Cancelled", "AbortError");
    }
    const progress = await readWorkspaceRunProgress(params.mode, params.paths);
    if (progress.completed) {
      return {
        progress,
        text: extractWorkspaceRunText(params.mode, progress),
      };
    }
    await waitForWorkspacePoll(params.pollIntervalMs ?? 800, params.signal);
  }
  throw new Error("Workspace run timed out.");
}
