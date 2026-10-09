import type { EngineMode } from "../ai/types";

function getEngineLabel(mode: EngineMode) {
  return mode === "claude_code" ? "Claude Code" : "Codex CLI";
}

export interface EngineSelectionPresentation {
  claudePressed: boolean;
  codexPressed: boolean;
  resetLabel: string;
  resetDisabled: boolean;
  resetTitle: string;
}

/** Engine buttons form a pressed-state group; reset names the real default. */
export function getEngineSelectionPresentation(params: {
  mode: EngineMode;
  defaultMode: EngineMode;
  hasOverride: boolean;
}): EngineSelectionPresentation {
  const defaultLabel = getEngineLabel(params.defaultMode);
  return {
    claudePressed: params.mode === "claude_code",
    codexPressed: params.mode === "codex_cli",
    resetLabel: `Use default (${defaultLabel})`,
    resetDisabled: !params.hasOverride,
    resetTitle: params.hasOverride
      ? `Remove this paper's engine choice and use the default engine, ${defaultLabel}.`
      : `This paper already uses the default engine, ${defaultLabel}.`,
  };
}

/** Save is meaningful only when the picker differs from the saved default. */
export function isModelSelectionDirty(params: {
  selectedModel: string;
  savedModel?: string;
  effortVisible: boolean;
  selectedEffort?: string;
  savedEffort?: string;
}): boolean {
  if (params.savedModel === undefined) return Boolean(params.selectedModel);
  if (params.selectedModel !== params.savedModel) return true;
  return (
    params.effortVisible &&
    (params.selectedEffort ?? "") !== (params.savedEffort ?? "")
  );
}

/** Authentication controls help only when Codex is not ready. */
export function shouldShowCodexAuthActions(
  mode: EngineMode,
  loginState?: string,
): boolean {
  return (
    mode === "codex_cli" &&
    (loginState === "login_required" ||
      loginState === "unavailable" ||
      loginState === "error")
  );
}
