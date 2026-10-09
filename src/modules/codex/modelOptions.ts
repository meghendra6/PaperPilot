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
    slug: "gpt-6-sol",
    displayName: "GPT-6-Sol",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultReasoningEffort: "low",
  },
  {
    slug: "gpt-6-luna",
    displayName: "GPT-6-Luna",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
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

interface ClaudeBuiltInModel {
  slug: string;
  displayName: string;
}

// Claude Code CLI aliases resolve to the newest model in each family (checked
// against Claude Code 2.1: opus → Opus 5.5, sonnet → Sonnet 5.5,
// haiku → Haiku 5.5, fable → Fable 5.1). Pinned ids follow so users can stay
// on a specific version. Any other id is passed through to the CLI unchanged.
const CLAUDE_BUILT_IN_MODEL_CATALOG: ClaudeBuiltInModel[] = [
  { slug: "sonnet", displayName: "Sonnet (latest)" },
  { slug: "opus", displayName: "Opus (latest)" },
  { slug: "haiku", displayName: "Haiku (latest)" },
  { slug: "fable", displayName: "Fable (latest)" },
  { slug: "claude-opus-5-5", displayName: "Opus 5.5" },
  { slug: "claude-sonnet-5-5", displayName: "Sonnet 5.5" },
  { slug: "claude-haiku-5-5", displayName: "Haiku 5.5" },
  { slug: "claude-fable-5-1", displayName: "Fable 5.1" },
  { slug: "claude-opus-5", displayName: "Opus 5" },
  { slug: "claude-sonnet-5", displayName: "Sonnet 5" },
];
const CLAUDE_DEFAULT_MODEL = CLAUDE_BUILT_IN_MODEL_CATALOG[0].slug;
const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet": "sonnet",
  "claude-opus": "opus",
  "claude-haiku": "haiku",
  "claude-fable": "fable",
};
const CLAUDE_FAMILIES = ["opus", "sonnet", "haiku", "fable"];
// Accepted by `claude --effort`. An empty value leaves the CLI default.
const CLAUDE_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function getClaudeBuiltInModels() {
  return CLAUDE_BUILT_IN_MODEL_CATALOG.map((model) => model.slug);
}

/**
 * Canonicalizes hand-typed Claude model names to the id the CLI expects:
 * "Opus 5.5" and "claude-opus-5.5" become "claude-opus-5-5", while a context
 * suffix such as "[1m]" is kept. Unrecognized ids pass through untouched.
 */
export function normalizeClaudeModel(model: string) {
  const trimmed = model.trim();
  if (!trimmed) return CLAUDE_DEFAULT_MODEL;

  const suffixMatch = trimmed.match(/\[([a-z0-9]+)\]$/i);
  const suffix = suffixMatch ? `[${suffixMatch[1].toLowerCase()}]` : "";
  const base = (suffixMatch ? trimmed.slice(0, suffixMatch.index) : trimmed)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  if (CLAUDE_MODEL_ALIASES[base]) return CLAUDE_MODEL_ALIASES[base] + suffix;
  if (CLAUDE_FAMILIES.includes(base)) return base + suffix;

  const versioned = base.match(
    /^(?:claude-)?(opus|sonnet|haiku|fable)-?(\d+)(?:[.-](\d))?(-\d{8})?$/,
  );
  if (versioned) {
    const [, family, major, minor, date] = versioned;
    return `claude-${family}-${major}${minor ? `-${minor}` : ""}${date ?? ""}${suffix}`;
  }

  return trimmed;
}

export function normalizeClaudeModelList(models: string[]) {
  return mergeModelOptions(
    [],
    models.map((model) => normalizeClaudeModel(model)).filter(Boolean),
  );
}

export function getClaudeModelLabel(model: string) {
  const suffixMatch = model.match(/\[([a-z0-9]+)\]$/);
  const base = suffixMatch ? model.slice(0, suffixMatch.index) : model;
  const entry = CLAUDE_BUILT_IN_MODEL_CATALOG.find(
    (candidate) => candidate.slug === base,
  );
  if (!entry) return model;
  if (!suffixMatch) return entry.displayName;
  const context = `${suffixMatch[1].toUpperCase()} context`;
  return entry.displayName.endsWith(")")
    ? `${entry.displayName.slice(0, -1)}, ${context})`
    : `${entry.displayName} (${context})`;
}

export function getClaudeReasoningEfforts() {
  return [...CLAUDE_REASONING_EFFORTS];
}

export function normalizeClaudeReasoningEffort(reasoningEffort: string) {
  const normalized = reasoningEffort.trim().toLowerCase();
  return CLAUDE_REASONING_EFFORTS.includes(normalized) ? normalized : "";
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
  const normalized = reasoningEffort.trim().toLowerCase();
  if (supportedEfforts.includes(normalized)) {
    return normalized;
  }
  return catalogModel?.defaultReasoningEffort ?? CODEX_DEFAULT_REASONING_EFFORT;
}

/** Every effort any built-in Codex model accepts, in catalog order. */
export function getCodexReasoningEffortOptions() {
  return [
    ...new Set(
      CODEX_BUILT_IN_MODEL_CATALOG.flatMap((model) => model.reasoningEfforts),
    ),
  ];
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
