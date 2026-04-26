export function parseAllowedModels(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mergeModelOptions(recent: string[], allowed: string[]) {
  return [...new Set([...recent, ...allowed])];
}

const CODEX_BUILT_IN_MODEL = "gpt-5.5";
const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"];
const CODEX_DEFAULT_REASONING_EFFORT = "medium";

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

export interface CachedCodexModel {
  slug: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort?: string;
}

export function getCodexBuiltInModels() {
  return [CODEX_BUILT_IN_MODEL];
}

export function getCodexBuiltInModelCatalog(): CachedCodexModel[] {
  return [
    {
      slug: CODEX_BUILT_IN_MODEL,
      displayName: CODEX_BUILT_IN_MODEL,
      reasoningEfforts: [...CODEX_REASONING_EFFORTS],
      defaultReasoningEffort: CODEX_DEFAULT_REASONING_EFFORT,
    },
  ];
}

export function normalizeCodexModel(model: string) {
  const normalized = model.trim();
  return normalized === CODEX_BUILT_IN_MODEL
    ? normalized
    : CODEX_BUILT_IN_MODEL;
}

export function normalizeCodexModelList(models: string[]) {
  return mergeModelOptions(
    [],
    models.map((model) => normalizeCodexModel(model)).filter(Boolean),
  );
}

export function normalizeCodexReasoningEffort(reasoningEffort: string) {
  const normalized = reasoningEffort.trim();
  return CODEX_REASONING_EFFORTS.includes(normalized)
    ? normalized
    : CODEX_DEFAULT_REASONING_EFFORT;
}
