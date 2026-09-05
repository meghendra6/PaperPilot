export function parseAllowedModels(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mergeModelOptions(recent: string[], allowed: string[]) {
  return [...new Set([...recent, ...allowed])];
}

interface CodexBuiltInModel {
  slug: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
}

// Keeps PaperPilot's picker on the current recommended Codex models.
// Unknown or retired saved values normalize to the default model below.
const CODEX_BUILT_IN_MODEL_CATALOG: CodexBuiltInModel[] = [
  {
    slug: "gpt-6-astra",
    displayName: "GPT-6-Astra",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultReasoningEffort: "medium",
  },
  {
    slug: "gpt-5.6-sol",
    displayName: "GPT-5.6-Sol",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultReasoningEffort: "low",
  },
  {
    slug: "gpt-5.6-terra",
    displayName: "GPT-5.6-Terra",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultReasoningEffort: "medium",
  },
  {
    slug: "gpt-5.6-luna",
    displayName: "GPT-5.6-Luna",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "medium",
  },
];

export const CODEX_DEFAULT_MODEL = CODEX_BUILT_IN_MODEL_CATALOG[0].slug;
const CODEX_DEFAULT_REASONING_EFFORT = "medium";

function findCodexBuiltInModel(slug: string) {
  return CODEX_BUILT_IN_MODEL_CATALOG.find((model) => model.slug === slug);
}

const GEMINI_BUILT_IN_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
];
const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-2.5-flash": "gemini-3-flash-preview",
};

// Claude Code CLI aliases: each resolves to the latest model in that family
// (sonnet → Sonnet 5, opus → Opus 5, haiku → Haiku 4.5, fable → Fable 5).
const CLAUDE_BUILT_IN_MODELS = ["sonnet", "opus", "haiku", "fable"];
const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet": "sonnet",
  "claude-opus": "opus",
  "claude-haiku": "haiku",
  "claude-fable": "fable",
};

export function getGeminiBuiltInModels() {
  return [...GEMINI_BUILT_IN_MODELS];
}

export function normalizeGeminiModel(model: string) {
  const normalized = model.trim();

  if (!normalized) {
    return GEMINI_BUILT_IN_MODELS[0];
  }

  return GEMINI_MODEL_ALIASES[normalized] || normalized;
}

export function normalizeGeminiModelList(models: string[]) {
  return mergeModelOptions(
    [],
    models.map((model) => normalizeGeminiModel(model)).filter(Boolean),
  );
}

export function getClaudeBuiltInModels() {
  return [...CLAUDE_BUILT_IN_MODELS];
}

export function normalizeClaudeModel(model: string) {
  const normalized = model.trim();

  if (!normalized) {
    return CLAUDE_BUILT_IN_MODELS[0];
  }

  return CLAUDE_MODEL_ALIASES[normalized] || normalized;
}

export function normalizeClaudeModelList(models: string[]) {
  return mergeModelOptions(
    [],
    models.map((model) => normalizeClaudeModel(model)).filter(Boolean),
  );
}

export interface CachedCodexModel {
  slug: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort?: string;
}

export function getCodexBuiltInModels() {
  return CODEX_BUILT_IN_MODEL_CATALOG.map((model) => model.slug);
}

export function getCodexBuiltInModelCatalog(): CachedCodexModel[] {
  return CODEX_BUILT_IN_MODEL_CATALOG.map((model) => ({
    slug: model.slug,
    displayName: model.displayName,
    reasoningEfforts: [...model.reasoningEfforts],
    defaultReasoningEffort: model.defaultReasoningEffort,
  }));
}

export function normalizeCodexModel(model: string) {
  const normalized = model.trim();
  return findCodexBuiltInModel(normalized) ? normalized : CODEX_DEFAULT_MODEL;
}

export function normalizeCodexModelList(models: string[]) {
  return mergeModelOptions(
    [],
    models.map((model) => normalizeCodexModel(model)).filter(Boolean),
  );
}

export function normalizeCodexReasoningEffort(
  reasoningEffort: string,
  model?: string,
) {
  const catalogModel = model ? findCodexBuiltInModel(model.trim()) : undefined;
  const supportedEfforts = catalogModel
    ? catalogModel.reasoningEfforts
    : findCodexBuiltInModel(CODEX_DEFAULT_MODEL)!.reasoningEfforts;
  const normalized = reasoningEffort.trim();
  if (supportedEfforts.includes(normalized)) {
    return normalized;
  }
  return catalogModel?.defaultReasoningEffort ?? CODEX_DEFAULT_REASONING_EFFORT;
}

// An empty/obsolete configured list uses the built-in catalog. This is a picker
// preference, not a security boundary; unknown model IDs are never admitted.
export function getAllowedCodexModels(value: string) {
  const allowed = [...new Set(parseAllowedModels(value))].filter((slug) =>
    Boolean(findCodexBuiltInModel(slug)),
  );
  return allowed.length ? allowed : getCodexBuiltInModels();
}

export function resolveCodexModel(model: string, allowedValue: string) {
  const allowed = getAllowedCodexModels(allowedValue);
  const normalized = normalizeCodexModel(model);
  return allowed.includes(normalized) ? normalized : allowed[0];
}
