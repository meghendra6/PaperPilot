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

const RUN_TIMEOUT_MS = 4 * 60 * 1000;

export async function runResearchWorkspaceAnalysis(params: {
  itemID: number;
  itemTitle: string;
  purpose: string;
  prompt: string;
  outputSchema?: StructuredOutputSchema;
  workspaceFiles?: WorkspaceSupplementalFiles;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const mode = getModeForItem(params.itemID);
  const engineLabel = getWorkspaceEngineLabel(mode);
  const reservationToken = claimWorkspaceRunReservation(mode, params.itemID);
  if (!reservationToken) {
    throw new Error(
      getWorkspaceEngineActiveMessage(mode, "this Research Workspace task"),
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
      itemID: params.itemID,
      reservationItemID: params.itemID,
      reservationToken,
      title: params.itemTitle,
      sessionId: `research-workspace-${params.purpose}-${params.itemID}-${Date.now()}`,
      question: params.prompt,
      profile: "analysis",
      outputSchema: params.outputSchema,
      workspaceFiles: params.workspaceFiles,
      signal: params.signal,
      deadline,
      onDeferredCleanup: (cleanup) => {
        releaseReservation = false;
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
      await cleanupWorkspaceIfEnabled(started.workspacePath);
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
    completed = true;
    if (completion.progress.exitCode !== "0") {
      throw new Error(completion.text || `${engineLabel} run failed.`);
    }
    return completion.text;
  } finally {
    if (started?.ok) {
      if (!completed) {
        try {
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
        await cleanupWorkspaceIfEnabled(started.workspacePath);
      }
    }
    if (releaseReservation) {
      releaseWorkspaceRunReservation(params.itemID, reservationToken);
    }
  }
}
