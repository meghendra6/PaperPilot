import { isClaudeRunActiveForItem } from "../claude/runState";
import { isCodexRunActiveForItem } from "../codex/runState";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import type {
  PrebuiltWorkspaceInput,
  RequestContextSnapshot,
  RunTimings,
} from "../context/requestContext";
import type { WorkspaceSupplementalFiles } from "../workspace/supplementalFiles";
import { parseChatAnswer } from "../message/chatAnswer";
import { sanitizeAssistantText } from "../message/assistantOutput";
import type { ExecutionSettings } from "./executionSettings";
import { stopDetachedRunProcess } from "./runCompletion";
import {
  claimDirectWorkspaceRun,
  directWorkspaceRunOwner,
  getPendingEngineCompletion,
  isPendingEngineCompletionCurrent,
  isDirectWorkspaceRunClaimCurrent,
  isDirectWorkspaceRunClaimed,
  isReaderLifecycleClaimActive,
  releaseDirectWorkspaceRun,
  releasePendingEngineCompletionClaim,
  reportRunStopFailure,
} from "./runLifecycle";
import type { ReaderRunToken } from "./runPresentation";
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

/** A polling failure can be terminal without proving that the process exited. */
export function hasConfirmedWorkspaceProcessExit(
  progress: Pick<
    WorkspaceRunProgress,
    "completed" | "exitCode" | "processExitCode"
  >,
): boolean {
  return (
    progress.completed &&
    /^\d+$/.test(progress.processExitCode ?? progress.exitCode)
  );
}

/** Retain reader ownership until an unreadable exit marker is safe to finalize. */
export async function confirmReaderRunProcessExit(params: {
  itemID: number;
  mode: EngineMode;
  token: ReaderRunToken;
  progress: Pick<
    WorkspaceRunProgress,
    "completed" | "exitCode" | "processExitCode"
  >;
  processId?: string;
}): Promise<boolean> {
  if (hasConfirmedWorkspaceProcessExit(params.progress)) return true;
  try {
    await stopDetachedRunProcess(params.processId, { requireProcessId: true });
    return isPendingEngineCompletionCurrent(params.itemID, params.token);
  } catch (error) {
    releasePendingEngineCompletionClaim(
      params.itemID,
      params.token,
      "controller",
    );
    const pending = getPendingEngineCompletion(params.itemID);
    if (pending?.token === params.token) {
      // The watchdog may have fired while this controller held the claim.
      pending.cancelTimeout?.();
      pending.rearmTimeout?.();
    }
    reportRunStopFailure({
      itemID: params.itemID,
      engine: params.mode,
      token: params.token,
      rawError: `Paper Pilot could not confirm process termination after reading its exit marker failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
}

/** A successful process must also produce a readable answer after decoding. */
export function resolveRunAnswer(params: {
  profile: RunProfile;
  parsedOutput: string;
  exitCode: string;
  providerFailed?: boolean;
  allowedSourceIDs?: ReadonlySet<string>;
}) {
  const answer =
    params.profile === "chat"
      ? parseChatAnswer(params.parsedOutput, {
          allowedSourceIDs: params.allowedSourceIDs,
        })
      : { answerMarkdown: params.parsedOutput, citationCandidates: [] };
  const processSucceeded = params.exitCode === "0" && !params.providerFailed;
  const readable = Boolean(sanitizeAssistantText(answer.answerMarkdown).trim());
  return {
    ...answer,
    success: processSucceeded && readable,
    invalidAnswer: processSucceeded && !readable,
  };
}

export function getWorkspaceEngineLabel(mode: EngineMode) {
  if (mode === "claude_code") {
    return "Claude Code";
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
  /** A PNG the engine should view; both runners copy it into the workspace. */
  imagePath?: string;
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
  /** Persist project ownership before a runner creates or stages any files. */
  onWorkspaceAllocated?: (workspacePath: string) => void | Promise<void>;
  /** Persist possible process ownership before the detached launch attempt. */
  onWorkspaceWillLaunch?: (workspacePath: string) => void | Promise<void>;
  onWorkspaceProcessStopped?: (workspacePath: string) => void | Promise<void>;
  stopWorkspaceProcess?: (
    result: Pick<WorkspaceRunResult, "workspacePath" | "processId">,
  ) => Promise<void>;
  /** Project ledgers retain failed-launch diagnostics until stop is confirmed. */
  preserveWorkspaceOnPreparationFailure?: boolean;
  prepareRun?: () => Promise<WorkspaceRunResult | FailedWorkspaceRun>;
}): Promise<WorkspaceRunResult | FailedWorkspaceRun> {
  // Runners stage an image only into a paper workspace; never drop it silently.
  if (params.imagePath && params.prebuiltInput)
    throw new Error(
      "An image input needs the paper workspace, not an admitted project input.",
    );
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
  const onWorkspaceAllocated = async (path: string) => {
    await params.onWorkspaceAllocated?.(path);
    allocatedPath = path;
  };
  const cleanupAllocated = () =>
    allocatedPath && !params.preserveWorkspaceOnPreparationFailure
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
        imagePath: params.imagePath,
        prebuiltInput: params.prebuiltInput,
        requestContext: params.requestContext,
        onWorkspaceAllocated,
        onWorkspaceWillLaunch: params.onWorkspaceWillLaunch,
        onWorkspaceLaunchAbandoned: params.onWorkspaceProcessStopped,
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
        imagePath: params.imagePath,
        prebuiltInput: params.prebuiltInput,
        requestContext: params.requestContext,
        onWorkspaceAllocated,
        onWorkspaceWillLaunch: params.onWorkspaceWillLaunch,
        onWorkspaceLaunchAbandoned: params.onWorkspaceProcessStopped,
        shouldContinue,
        executionSettings: params.executionSettings,
      });
    }

    return result;
  };
  const preparation = (params.prepareRun || prepare)().then((result) => {
    allocatedPath = result.workspacePath;
    if (result.ok) {
      owner.registerProcess(params.mode, result.processId);
    }
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
            if (params.stopWorkspaceProcess)
              await params.stopWorkspaceProcess(result);
            else
              await stopDetachedRunProcess(result.processId, {
                requireProcessId: true,
              });
            await params.onWorkspaceProcessStopped?.(result.workspacePath);
          } else if (params.stopWorkspaceProcess) {
            await params.stopWorkspaceProcess({
              workspacePath: result.workspacePath,
            });
            await params.onWorkspaceProcessStopped?.(result.workspacePath);
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

/**
 * The Zotero add-on sandbox has no DOMException. Constructing one inside the
 * abort listener threw, so the wait never settled and Stop left the paper
 * reserved. Callers identify cancellation by `name`.
 */
export function createWorkspaceCancelledError(): Error {
  const error = new Error("Cancelled");
  error.name = "AbortError";
  return error;
}

function waitForWorkspacePoll(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createWorkspaceCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createWorkspaceCancelledError());
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
      throw createWorkspaceCancelledError();
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
