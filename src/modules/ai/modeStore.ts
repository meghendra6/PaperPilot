import { getPref, setPref } from "../../utils/prefs";
import type { EngineMode } from "./types";

declare const addon: any;

// Hand-typed names saved before settings offered a list. Gemini CLI was
// removed, so its saved default falls back to Codex CLI.
const ENGINE_MODE_ALIASES = new Map<string, EngineMode>([
  ["codexcli", "codex_cli"],
  ["codex", "codex_cli"],
  ["claudecode", "claude_code"],
  ["claude", "claude_code"],
  ["geminicli", "codex_cli"],
]);

/** Maps a saved default mode to an engine. Unknown values return undefined. */
export function resolveEngineMode(value: unknown): EngineMode | undefined {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return ENGINE_MODE_ALIASES.get(key);
}

export function getDefaultMode(): EngineMode {
  return resolveEngineMode(getPref("defaultMode")) ?? "codex_cli";
}

/** Rewrites a default saved before Gemini CLI was removed so settings stop showing it. */
export function migrateLegacyDefaultMode(
  read: typeof getPref = getPref,
  write: typeof setPref = setPref,
) {
  if (read("defaultMode") === "gemini_cli") write("defaultMode", "codex_cli");
}

export function getModeForItem(itemID: number): EngineMode {
  return addon.data.modeOverrides?.get(itemID) ?? getDefaultMode();
}

export function setModeOverrideForItem(itemID: number, mode: EngineMode) {
  addon.data.modeOverrides?.set(itemID, mode);
}

export function clearModeOverrideForItem(itemID: number) {
  addon.data.modeOverrides?.delete(itemID);
}
