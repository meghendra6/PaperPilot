/** Values accepted by `claude --permission-mode`, in settings display order. */
export const CLAUDE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

function compactKey(value: string) {
  return value.toLowerCase().replace(/[\s_'-]+/g, "");
}

const PERMISSION_MODES_BY_KEY = new Map<string, ClaudePermissionMode>(
  CLAUDE_PERMISSION_MODES.map((mode) => [compactKey(mode), mode]),
);

/**
 * Maps a saved permission mode to the CLI value. Letter case, spaces,
 * hyphens, underscores, and apostrophes are ignored, so "acceptedits" and
 * "Don't ask" resolve. Unknown values return undefined.
 */
export function resolveClaudePermissionMode(
  value: unknown,
): ClaudePermissionMode | undefined {
  const key = compactKey(String(value ?? "").trim());
  return key ? PERMISSION_MODES_BY_KEY.get(key) : undefined;
}
