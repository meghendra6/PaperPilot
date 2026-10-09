/** Values accepted by `codex exec --sandbox`, in settings display order. */
export const CODEX_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type CodexSandboxMode = (typeof CODEX_SANDBOX_MODES)[number];

/**
 * Maps a saved sandbox mode to the CLI value. Letter case is ignored, and
 * spaces or underscores count as hyphens, so "Workspace write" resolves.
 * Unknown values return undefined.
 */
export function resolveCodexSandboxMode(
  value: unknown,
): CodexSandboxMode | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (normalized === "readonly") return "read-only";
  return CODEX_SANDBOX_MODES.find((mode) => mode === normalized);
}

/** Runtime safety net: unknown values run in the read-only sandbox. */
export function normalizeCodexSandboxMode(value: string): CodexSandboxMode {
  return resolveCodexSandboxMode(value) ?? "read-only";
}
