import { getPref } from "../../utils/prefs";
import type { EngineMode } from "./types";

declare const addon: any;

export function getDefaultMode(): EngineMode {
  const prefMode = getPref("defaultMode");
  return prefMode === "gemini_cli" ||
    prefMode === "claude_code" ||
    prefMode === "codex_cli"
    ? prefMode
    : "codex_cli";
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
