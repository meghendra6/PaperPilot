import type { EngineMode } from "./types";
import { isClaudeRunActiveForItem } from "../claude/runState";
import { parseCodexOutputText } from "../codex/outputParser";
import { isCodexRunActiveForItem } from "../codex/runState";
import { isGeminiRunActiveForItem } from "../gemini/runState";

export interface WorkspaceRunResult {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
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
  if (mode === "claude_code") {
    return isClaudeRunActiveForItem(itemID);
  }
  if (mode === "gemini_cli") {
    return isGeminiRunActiveForItem(itemID);
  }
  return isCodexRunActiveForItem(itemID);
}

export async function startWorkspaceTextRun(params: {
  mode: EngineMode;
  itemID: number;
  title: string;
  sessionId: string;
  question: string;
}): Promise<WorkspaceRunResult | FailedWorkspaceRun> {
  if (params.mode === "claude_code") {
    const { startClaudeRunForQuestion } = await import("../claude/runner");
    return startClaudeRunForQuestion({
      itemID: params.itemID,
      title: params.title,
      sessionId: params.sessionId,
      question: params.question,
    });
  }

  if (params.mode === "gemini_cli") {
    const { startGeminiRunForQuestion } = await import("../gemini/runner");
    return startGeminiRunForQuestion({
      itemID: params.itemID,
      title: params.title,
      sessionId: params.sessionId,
      question: params.question,
    });
  }

  const { startCodexRunForQuestion } = await import("../codex/runner");
  return startCodexRunForQuestion({
    itemID: params.itemID,
    title: params.title,
    sessionId: params.sessionId,
    question: params.question,
    useResume: false,
  });
}

export async function readWorkspaceRunProgress(
  mode: EngineMode,
  paths: {
    outputPath: string;
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
  mode: EngineMode,
  progress: Pick<WorkspaceRunProgress, "rawOutput" | "parsedOutput">,
) {
  if (mode === "codex_cli") {
    return (
      parseCodexOutputText(progress.rawOutput) ||
      progress.parsedOutput ||
      progress.rawOutput
    );
  }

  return progress.parsedOutput || progress.rawOutput;
}
