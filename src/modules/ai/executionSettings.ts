import { getPref } from "../../utils/prefs";
import {
  normalizeClaudeModel,
  normalizeClaudeReasoningEffort,
  normalizeCodexReasoningEffort,
  resolveCodexModel,
} from "../codex/modelOptions";
import {
  normalizeResponseLanguage,
  type SupportedResponseLanguage,
} from "../translation/responseLanguage";
import type { EngineMode } from "./types";

export interface ExecutionSettings {
  readonly mode: EngineMode;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly responseLanguage: SupportedResponseLanguage;
}

/** One immutable snapshot shared by prompt construction, every unit, and lineage. */
export function captureExecutionSettings(
  mode: EngineMode,
  read: typeof getPref = getPref,
): ExecutionSettings {
  const responseLanguage = normalizeResponseLanguage(read("responseLanguage"));
  if (mode === "claude_code") {
    const reasoningEffort = normalizeClaudeReasoningEffort(
      String(read("claudeReasoningEffort") || ""),
    );
    return Object.freeze({
      mode,
      responseLanguage,
      model: normalizeClaudeModel(String(read("claudeDefaultModel") || "")),
      // Empty means "let the Claude Code CLI pick its own default effort".
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
  }
  const model = resolveCodexModel(
    String(read("codexDefaultModel") || ""),
    String(read("codexAllowedModels") || ""),
  );
  return Object.freeze({
    mode,
    model,
    responseLanguage,
    reasoningEffort: normalizeCodexReasoningEffort(
      String(read("codexReasoningEffort") || "medium"),
      model,
    ),
  });
}

export function executionSettingsForMode(
  mode: EngineMode,
  snapshot?: ExecutionSettings,
): ExecutionSettings {
  if (snapshot && snapshot.mode !== mode)
    throw new Error("Execution settings do not match the selected engine.");
  return snapshot ?? captureExecutionSettings(mode);
}
