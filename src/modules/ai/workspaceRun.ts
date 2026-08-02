import type { EngineMode } from "./types";
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

  try {
    let result: WorkspaceRunResult | FailedWorkspaceRun;
    if (params.mode === "claude_code") {
      const { startClaudeRunForQuestion } = await import("../claude/runner");
      result = await startClaudeRunForQuestion({
        itemID: params.itemID,
        title: params.title,
        sessionId: params.sessionId,
        question: params.question,
      });
    } else if (params.mode === "gemini_cli") {
      const { startGeminiRunForQuestion } = await import("../gemini/runner");
      result = await startGeminiRunForQuestion({
        itemID: params.itemID,
        title: params.title,
        sessionId: params.sessionId,
        question: params.question,
      });
    } else {
      const { startCodexRunForQuestion } = await import("../codex/runner");
      result = await startCodexRunForQuestion({
        itemID: params.itemID,
        title: params.title,
        sessionId: params.sessionId,
        question: params.question,
        useResume: false,
      });
    }

    return result;
  } catch (error) {
    await cleanupPaperWorkspaceForItemIfEnabled({
      itemID: params.itemID,
      title: params.title,
    });
    throw error;
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
