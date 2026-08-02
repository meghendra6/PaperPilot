import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { finishRunAfterCleanup } from "./runCompletion";
import {
  clearPendingEngineCompletion,
  failRunProgress,
  persistRunFailure,
} from "./runLifecycle";
import {
  getRunProgressState,
  isRunProgressActive,
  RUN_TIMEOUT_MS,
} from "./runProgress";
import type {
  ReaderRunCompletionResult,
  ReaderRunToken,
} from "./runPresentation";
import type { EngineMode } from "./types";

export function armRunTimeout(params: {
  itemID: number;
  shouldTimeout?: () => boolean;
  onTimeout: () => void | Promise<void>;
}): () => void {
  const state = getRunProgressState(params.itemID);
  const startedAt = state?.startedAt ?? Date.now();
  const delay = Math.max(0, RUN_TIMEOUT_MS - (Date.now() - startedAt));
  let active = true;
  const timer = setTimeout(() => {
    if (!active) return;
    active = false;
    const current = getRunProgressState(params.itemID);
    if (
      current &&
      current.startedAt === startedAt &&
      isRunProgressActive(current) &&
      params.shouldTimeout?.() !== false
    ) {
      void params.onTimeout();
    }
  }, delay);

  return () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
  };
}

export async function completeTimedOutRun(params: {
  itemID: number;
  sessionId: string;
  sessionTitle: string;
  paperTitle?: string;
  engine: EngineMode;
  engineLabel: string;
  token: ReaderRunToken;
  workspacePath?: string;
  suppressMessage?: boolean;
  stop: () => void | Promise<void>;
  onMessage?: (message: string) => void;
  onComplete?: (result: ReaderRunCompletionResult) => void | Promise<void>;
}): Promise<void> {
  await Promise.resolve(params.stop()).catch(() => undefined);
  const rawError = `${params.engineLabel} exceeded the 30-minute run limit.`;
  const failure = await persistRunFailure({
    itemID: params.itemID,
    sessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
    paperTitle: params.paperTitle,
    engine: params.engine,
    rawError,
    source: "timeout",
    suppressMessage: params.suppressMessage,
  }).catch(
    () =>
      failRunProgress({
        itemID: params.itemID,
        engine: params.engine,
        rawError,
        source: "timeout",
        canRetry: !params.suppressMessage,
      }).failure!,
  );
  params.onMessage?.(failure.userMessage);

  const complete = () =>
    params.onComplete?.({
      success: false,
      assistantText: failure.userMessage,
    });
  try {
    await finishRunAfterCleanup({
      prepare: () => undefined,
      cleanup: () =>
        params.workspacePath
          ? cleanupWorkspaceIfEnabled(params.workspacePath)
          : undefined,
      complete,
      incomplete: complete,
      finalize: () => clearPendingEngineCompletion(params.itemID, params.token),
    });
  } catch {
    // The callback has already released silent workflow state.
  }
}
