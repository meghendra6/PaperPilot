import { stopDetachedRunProcess } from "./runCompletion";
import type { ReaderLifecycleClaim } from "./runLifecycle";
import type { EngineMode } from "./types";

type ShutdownRunData = {
  readerLifecycleClaims?: Map<number, ReaderLifecycleClaim>;
  codexRunStates?: Map<number, { processId?: string; runStatus?: string }>;
  claudeRunStates?: Map<number, { processId?: string }>;
  geminiRunStates?: Map<number, { processId?: string }>;
  codexRunPollers?: Map<number, unknown>;
  claudeRunPollers?: Map<number, unknown>;
  geminiRunPollers?: Map<number, unknown>;
  pendingEngineCompletions?: Map<number, { mode: EngineMode }>;
};

export interface ShutdownRun {
  itemID: number;
  mode: EngineMode;
  processId?: string;
}

export function collectShutdownRuns(
  data: ShutdownRunData,
  activeRuns: Array<{ itemID: number; mode: EngineMode }> = [],
): ShutdownRun[] {
  const keys = new Map<string, ShutdownRun>();
  const add = (itemID: number, mode: EngineMode, processId?: string) => {
    const key = `${mode}:${itemID}`;
    const existing = keys.get(key);
    keys.set(key, {
      itemID,
      mode,
      processId: processId || existing?.processId,
    });
  };

  data.codexRunStates?.forEach((state, itemID) => {
    if (state.runStatus === "running") {
      add(itemID, "codex_cli", state.processId);
    }
  });
  data.claudeRunStates?.forEach((state, itemID) =>
    add(itemID, "claude_code", state.processId),
  );
  data.geminiRunStates?.forEach((state, itemID) =>
    add(itemID, "gemini_cli", state.processId),
  );
  data.codexRunPollers?.forEach((_poller, itemID) =>
    add(itemID, "codex_cli", data.codexRunStates?.get(itemID)?.processId),
  );
  data.claudeRunPollers?.forEach((_poller, itemID) =>
    add(itemID, "claude_code", data.claudeRunStates?.get(itemID)?.processId),
  );
  data.geminiRunPollers?.forEach((_poller, itemID) =>
    add(itemID, "gemini_cli", data.geminiRunStates?.get(itemID)?.processId),
  );
  data.pendingEngineCompletions?.forEach((pending, itemID) => {
    const processId =
      pending.mode === "codex_cli"
        ? data.codexRunStates?.get(itemID)?.processId
        : pending.mode === "claude_code"
          ? data.claudeRunStates?.get(itemID)?.processId
          : data.geminiRunStates?.get(itemID)?.processId;
    add(itemID, pending.mode, processId);
  });
  data.readerLifecycleClaims?.forEach((claim, itemID) => {
    if (claim.kind === "direct_workspace" && claim.mode)
      add(itemID, claim.mode, claim.processId);
  });
  for (const active of activeRuns) add(active.itemID, active.mode);
  return [...keys.values()];
}

export function stopShutdownRunsBestEffort(params: {
  runs: ShutdownRun[];
  stop?: typeof stopDetachedRunProcess;
  log?: (...values: unknown[]) => void;
}): Promise<void> {
  const stop = params.stop ?? stopDetachedRunProcess;
  const pending: Promise<void>[] = [];
  for (const run of params.runs) {
    if (!run.processId) {
      params.log?.(
        `Paper Pilot shutdown could not resolve a pid for ${run.mode} item ${run.itemID}.`,
      );
      continue;
    }
    pending.push(
      stop(run.processId, { requireProcessId: true }).catch((error) => {
        params.log?.(
          `Paper Pilot shutdown could not stop ${run.mode} item ${run.itemID}:`,
          error,
        );
      }),
    );
  }
  return Promise.all(pending).then(() => undefined);
}
