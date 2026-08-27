import { getModeForItem } from "../ai/modeStore";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import type { StructuredOutputSchema } from "../ai/structuredOutput";
import {
  claimWorkspaceRunReservation,
  extractWorkspaceRunText,
  getWorkspaceEngineActiveMessage,
  getWorkspaceEngineLabel,
  readWorkspaceRunProgress,
  releaseWorkspaceRunReservation,
  startWorkspaceTextRun,
} from "../ai/workspaceRun";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";

const POLL_INTERVAL_MS = 800;
const RUN_TIMEOUT_MS = 4 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runResearchWorkspaceAnalysis(params: {
  itemID: number;
  itemTitle: string;
  purpose: string;
  prompt: string;
  outputSchema?: StructuredOutputSchema;
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
      signal: params.signal,
      deadline,
      onDeferredCleanup: (cleanup) => {
        releaseReservation = false;
        void cleanup.finally(() =>
          releaseWorkspaceRunReservation(params.itemID, reservationToken),
        );
      },
    });

    if (!started.ok) {
      await cleanupWorkspaceIfEnabled(started.workspacePath);
      throw new Error(started.error || `${engineLabel} run could not start.`);
    }

    params.onStatus?.(`${engineLabel} is analyzing the paper…`);
    while (Date.now() < deadline) {
      if (params.signal?.aborted) {
        throw new Error("Research Workspace task cancelled.");
      }
      const progress = await readWorkspaceRunProgress(mode, {
        outputPath: started.outputPath,
        stderrPath: started.stderrPath,
        exitCodePath: started.exitCodePath,
      });
      if (progress.completed) {
        completed = true;
        const text = extractWorkspaceRunText(mode, progress);
        if (progress.exitCode !== "0") {
          throw new Error(text || `${engineLabel} run failed.`);
        }
        return text;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`${engineLabel} Research Workspace run timed out.`);
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
