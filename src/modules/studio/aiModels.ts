import {
  getAllowedCodexModels,
  getClaudeBuiltInModels,
  getClaudeModelLabel,
  getCodexBuiltInModelCatalog,
  mergeModelOptions,
  normalizeClaudeModelList,
  parseAllowedModels,
} from "../codex/modelOptions";
import type { StudioAIDefaults, StudioModelChoice } from "./aiContracts";

export interface StudioModelSettings {
  /** The reader's engine mode or the project's default engine mode. */
  engineMode?: string;
  codexModel: string;
  claudeModel: string;
  codexAllowed: string;
  claudeAllowed: string;
}

/**
 * Builds the assistant's picker defaults from the reader's engine settings:
 * the same allowed Codex models and the configured Claude models, each list
 * containing its default model.
 */
export function studioModelDefaults(
  settings: StudioModelSettings,
): StudioAIDefaults {
  const allowedCodex = getAllowedCodexModels(settings.codexAllowed);
  const codex: StudioModelChoice[] = getCodexBuiltInModelCatalog()
    .filter((model) => allowedCodex.includes(model.slug))
    .map((model) => ({ value: model.slug, label: model.displayName }));
  const claude: StudioModelChoice[] = mergeModelOptions(
    normalizeClaudeModelList(parseAllowedModels(settings.claudeAllowed)),
    getClaudeBuiltInModels(),
  ).map((model) => ({ value: model, label: getClaudeModelLabel(model) }));
  const include = (list: StudioModelChoice[], value: string) =>
    value && !list.some((choice) => choice.value === value)
      ? [{ value, label: value }, ...list]
      : list;
  return {
    provider: settings.engineMode === "claude_code" ? "claude" : "codex",
    codex: settings.codexModel,
    claude: settings.claudeModel,
    models: {
      codex: include(codex, settings.codexModel),
      claude: include(claude, settings.claudeModel),
    },
  };
}
