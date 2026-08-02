import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";
import { finishRunAfterCleanup } from "./runCompletion";
import { classifyRunFailure } from "./runFailure";
import {
  claimPendingEngineCompletion,
  failRunProgress,
  isPendingEngineCompletionCurrent,
  markPendingEngineTerminalSettled,
  persistRunFailure,
  releasePendingEngineCompletionClaim,
  reportRunStopFailure,
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
import { markReaderRunFinished } from "./runPresentation";
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
  const pending = claimPendingEngineCompletion(
    params.itemID,
    params.token,
    "timeout",
  );
  if (!pending) return;
  const workspacePath = pending.workspacePath ?? params.workspacePath;
  const rawError = `${params.engineLabel} exceeded the 30-minute run limit.`;
  try {
    await Promise.resolve(params.stop());
  } catch (error) {
    releasePendingEngineCompletionClaim(params.itemID, params.token, "timeout");
    const detail = error instanceof Error ? error.message : String(error);
    reportRunStopFailure({
      itemID: params.itemID,
      engine: params.engine,
      token: params.token,
      rawError: `Paper Pilot could not confirm process termination after timeout: ${detail}`,
    });
    return;
  }

  pending.cleanupClaimed = Boolean(workspacePath);
  const failurePromise = persistRunFailure({
    itemID: params.itemID,
    sessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
    paperTitle: params.paperTitle,
    engine: params.engine,
    token: params.token,
    rawError,
    source: "timeout",
    suppressMessage: params.suppressMessage,
  }).catch(
    () =>
      failRunProgress({
        itemID: params.itemID,
        engine: params.engine,
        token: params.token,
        rawError,
        source: "timeout",
        canRetry: !params.suppressMessage,
      })?.failure ??
      classifyRunFailure({
        engine: params.engine,
        rawError,
        source: "timeout",
      }),
  );
  markReaderRunFinished(params.itemID, params.token);
  const failure = await failurePromise;
  if (!isPendingEngineCompletionCurrent(params.itemID, params.token)) return;
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
        workspacePath ? cleanupWorkspaceIfEnabled(workspacePath) : undefined,
      complete,
      incomplete: complete,
      finalize: () =>
        markPendingEngineTerminalSettled(params.itemID, params.token),
    });
  } catch {
    // The callback has already released silent workflow state.
  }
}
