import { resolveEngineMode } from "../ai/modeStore";
import {
  CLAUDE_PERMISSION_MODES,
  resolveClaudePermissionMode,
} from "../claude/permissionMode";
import {
  CODEX_APPROVAL_MODES,
  normalizeCodexApprovalMode,
} from "../codex/commandBuilder";
import {
  getClaudeReasoningEfforts,
  getCodexReasoningEffortOptions,
  normalizeClaudeReasoningEffort,
} from "../codex/modelOptions";
import {
  CODEX_SANDBOX_MODES,
  resolveCodexSandboxMode,
} from "../codex/sandboxMode";

export type ChoicePreferenceKey =
  | "defaultMode"
  | "claudeReasoningEffort"
  | "claudePermissionMode"
  | "codexReasoningEffort"
  | "codexSandboxMode"
  | "codexApprovalMode";

/** A string preference that the settings pane shows as a fixed list. */
export interface ChoicePreferenceField {
  readonly key: ChoicePreferenceKey;
  /** Suffix of the select id `zotero-prefpane-<addonRef>-input-<suffix>`. */
  readonly inputSuffix: string;
  /** Option values in display order. They must match preferences.xhtml. */
  readonly options: readonly string[];
  /** Option the runtime already uses when the saved value is empty. */
  readonly emptyValue: string;
  /** Fluent message for a saved value that matches no option. */
  readonly unrecognizedL10nId: string;
  /** Canonical option for a non-empty saved value, or undefined if unknown. */
  readonly resolve: (value: string) => string | undefined;
}

export type ChoiceResolution =
  | {
      readonly kind: "known";
      readonly value: string;
      /** True when the saved text differs from the canonical option. */
      readonly repaired: boolean;
    }
  | { readonly kind: "unrecognized"; readonly value: string };

function codexReasoningEffort(value: string) {
  const normalized = value.trim().toLowerCase();
  return getCodexReasoningEffortOptions().includes(normalized)
    ? normalized
    : undefined;
}

export const CHOICE_PREFERENCE_FIELDS: readonly ChoicePreferenceField[] = [
  {
    key: "defaultMode",
    inputSuffix: "default-mode",
    options: ["codex_cli", "claude_code"],
    emptyValue: "codex_cli",
    unrecognizedL10nId: "pref-general-default-mode-unrecognized",
    resolve: resolveEngineMode,
  },
  {
    key: "claudeReasoningEffort",
    inputSuffix: "claude-reasoning-effort",
    options: ["", ...getClaudeReasoningEfforts()],
    emptyValue: "",
    unrecognizedL10nId: "pref-claude-reasoning-effort-unrecognized",
    resolve: (value) => normalizeClaudeReasoningEffort(value) || undefined,
  },
  {
    key: "claudePermissionMode",
    inputSuffix: "claude-permission-mode",
    options: CLAUDE_PERMISSION_MODES,
    emptyValue: "default",
    unrecognizedL10nId: "pref-claude-permission-mode-unrecognized",
    resolve: resolveClaudePermissionMode,
  },
  {
    key: "codexReasoningEffort",
    inputSuffix: "codex-reasoning-effort",
    options: getCodexReasoningEffortOptions(),
    emptyValue: "medium",
    unrecognizedL10nId: "pref-codex-reasoning-effort-unrecognized",
    resolve: codexReasoningEffort,
  },
  {
    key: "codexSandboxMode",
    inputSuffix: "codex-sandbox-mode",
    options: CODEX_SANDBOX_MODES,
    emptyValue: "read-only",
    unrecognizedL10nId: "pref-codex-sandbox-mode-unrecognized",
    resolve: resolveCodexSandboxMode,
  },
  {
    key: "codexApprovalMode",
    inputSuffix: "codex-approval-mode",
    options: CODEX_APPROVAL_MODES,
    // The Codex runner reads an empty value as "never".
    emptyValue: "never",
    unrecognizedL10nId: "pref-codex-approval-mode-unrecognized",
    resolve: (value) => normalizeCodexApprovalMode(value),
  },
];

export function getChoicePreferenceField(
  key: ChoicePreferenceKey,
): ChoicePreferenceField {
  const field = CHOICE_PREFERENCE_FIELDS.find((entry) => entry.key === key);
  if (!field) throw new Error(`Unknown choice preference: ${key}`);
  return field;
}

/**
 * Matches a saved preference to a select option. Known spellings resolve to
 * their canonical option. Unknown text is reported unchanged so the pane can
 * show it instead of erasing it.
 */
export function resolveChoicePreference(
  field: ChoicePreferenceField,
  raw: unknown,
): ChoiceResolution {
  const saved = raw === undefined || raw === null ? "" : String(raw);
  const value = saved.trim() ? field.resolve(saved) : field.emptyValue;
  if (value === undefined) return { kind: "unrecognized", value: saved };
  return { kind: "known", value, repaired: value !== saved };
}
