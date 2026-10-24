import {
  captureExecutionSettings,
  type ExecutionSettings,
} from "../ai/executionSettings";
import { getModeForItem } from "../ai/modeStore";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import type { StructuredOutputSchema } from "../ai/structuredOutput";
import {
  claimWorkspaceRunReservation,
  getWorkspaceEngineActiveMessage,
  getWorkspaceEngineLabel,
  releaseReservationAfterConfirmedCleanup,
  releaseWorkspaceRunReservation,
  startWorkspaceTextRun,
  waitForWorkspaceTextRun,
} from "../ai/workspaceRun";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import type { WorkspaceSupplementalFiles } from "../workspace/supplementalFiles";
import type {
  PrebuiltWorkspaceInput,
  RequestContextSnapshot,
} from "../context/requestContext";
import type { EngineMode } from "../ai/types";
import {
  projectWorkspaceCleanup,
  type ResearchWorkspaceProjectWorkspaceCleanup,
} from "./persistence/projectWorkspaceCleanup";

const RUN_TIMEOUT_MS = 4 * 60 * 1000;

/** A completed run that failed; callers may classify its diagnostics. */
export class WorkspaceAnalysisRunError extends Error {
  constructor(
    message: string,
    readonly mode: EngineMode,
    readonly diagnosticOutput: string,
  ) {
    super(message);
    this.name = "WorkspaceAnalysisRunError";
  }
}

interface ResearchWorkspaceAnalysisParams {
  projectID?: string;
  itemID: number;
  itemTitle: string;
  purpose: string;
  prompt: string;
  outputSchema?: StructuredOutputSchema;
  workspaceFiles?: WorkspaceSupplementalFiles;
  prebuiltInput?: PrebuiltWorkspaceInput;
  requestContext?: RequestContextSnapshot;
  imagePath?: string;
  executionSettings?: ExecutionSettings;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  /** Names the task in the busy message; defaults to Research Workspace. */
  taskLabel?: string;
}

export function runResearchWorkspaceAnalysis(
  params: ResearchWorkspaceAnalysisParams,
) {
  const cleanup = params.projectID ? projectWorkspaceCleanup() : undefined;
  return cleanup && params.projectID
    ? cleanup.run(params.projectID, () => runAnalysis(params, cleanup))
    : runAnalysis(params);
}

async function runAnalysis(
  params: ResearchWorkspaceAnalysisParams,
  projectCleanup?: ResearchWorkspaceProjectWorkspaceCleanup,
) {
  const projectID = params.projectID;
  const settings =
    params.executionSettings ??
    captureExecutionSettings(getModeForItem(params.itemID));
  const mode = settings.mode;
  const engineLabel = getWorkspaceEngineLabel(mode);
  const reservationToken = claimWorkspaceRunReservation(mode, params.itemID);
  if (!reservationToken) {
    throw new Error(
      getWorkspaceEngineActiveMessage(
        mode,
        params.taskLabel ?? "this Research Workspace task",
      ),
    );
  }

  let releaseReservation = true;
  let started: Awaited<ReturnType<typeof startWorkspaceTextRun>> | undefined;
  let completed = false;
  const deadline = Date.now() + RUN_TIMEOUT_MS;

  try {
    params.onStatus?.(`Starting ${engineLabel}…`);
    started = await startWorkspaceTextRun({
      mode,
      executionSettings: settings,
      itemID: params.itemID,
      reservationItemID: params.itemID,
      reservationToken,
      title: params.itemTitle,
      sessionId: `research-workspace-${params.purpose}-${params.itemID}-${Date.now()}`,
      question: params.prompt,
      profile: "analysis",
      outputSchema: params.outputSchema,
      workspaceFiles: params.workspaceFiles,
      prebuiltInput: params.prebuiltInput,
      requestContext: params.requestContext,
      imagePath: params.imagePath,
      signal: params.signal,
      deadline,
      onWorkspaceAllocated:
        projectID && projectCleanup
          ? (path) => projectCleanup.register(projectID, path, mode)
          : undefined,
      onWorkspaceWillLaunch:
        projectID && projectCleanup
          ? (path) => projectCleanup.markLaunching(projectID, path)
          : undefined,
      onWorkspaceProcessStopped:
        projectID && projectCleanup
          ? (path) => projectCleanup.confirmStopped(projectID, path)
          : undefined,
      stopWorkspaceProcess:
        projectID && projectCleanup
          ? (result) =>
              projectCleanup.stopProcess(projectID, result.workspacePath)
          : undefined,
      preserveWorkspaceOnPreparationFailure: Boolean(projectCleanup),
      onDeferredCleanup: (cleanup) => {
        releaseReservation = false;
        if (params.projectID && projectCleanup)
          projectCleanup.track(params.projectID, cleanup);
        releaseReservationAfterConfirmedCleanup(
          cleanup,
          () => releaseWorkspaceRunReservation(params.itemID, reservationToken),
          () =>
            params.onStatus?.(
              `${engineLabel} could not be stopped; the paper remains reserved until Zotero restarts.`,
            ),
        );
      },
    });

    if (!started.ok) {
      if (projectCleanup && projectID) {
        try {
          await projectCleanup.stopProcess(projectID, started.workspacePath);
          await projectCleanup.confirmStopped(projectID, started.workspacePath);
        } catch {
          releaseReservation = false;
          params.onStatus?.(
            `${engineLabel} launch cleanup is not confirmed; retry project deletion after the process stops.`,
          );
        }
      } else await cleanupWorkspaceIfEnabled(started.workspacePath);
      throw new Error(started.error || `${engineLabel} run could not start.`);
    }

    params.onStatus?.(`${engineLabel} is analyzing the paper…`);
    const completion = await waitForWorkspaceTextRun({
      mode,
      paths: {
        outputPath: started.outputPath,
        stderrPath: started.stderrPath,
        exitCodePath: started.exitCodePath,
      },
      deadline,
      signal: params.signal,
    });
    // A read error can end polling without proving that the CLI exited.
    completed = /^\d+$/.test(
      completion.progress.processExitCode ?? completion.progress.exitCode,
    );
    if (completion.progress.exitCode !== "0") {
      throw new WorkspaceAnalysisRunError(
        completion.text || `${engineLabel} run failed.`,
        mode,
        completion.progress.diagnosticOutput,
      );
    }
    return completion.text;
  } finally {
    if (started?.ok) {
      if (!completed) {
        try {
          if (projectID && projectCleanup)
            await projectCleanup.stopProcess(projectID, started.workspacePath);
          else
            await stopDetachedRunProcess(started.processId, {
              requireProcessId: true,
            });
        } catch {
          releaseReservation = false;
          params.onStatus?.(
            `${engineLabel} could not be stopped; the paper remains reserved until Zotero restarts.`,
          );
        }
      }
      if (completed || releaseReservation) {
        if (params.projectID && projectCleanup)
          await projectCleanup.confirmStopped(
            params.projectID,
            started.workspacePath,
          );
        await cleanupWorkspaceIfEnabled(started.workspacePath);
      }
    }
    if (releaseReservation) {
      releaseWorkspaceRunReservation(params.itemID, reservationToken);
    }
  }
}
