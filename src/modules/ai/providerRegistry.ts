import type { ReaderAiProvider } from "./provider";
import type { EngineMode } from "./types";
import { getDefaultMode, getModeForItem } from "./modeStore";
import { CodexCliProvider } from "./providers/codexCliProvider";
import { GeminiCliProvider } from "./providers/geminiCliProvider";

const providers: Record<EngineMode, ReaderAiProvider> = {
  codex_cli: new CodexCliProvider(),
  gemini_cli: new GeminiCliProvider(),
};

export function getProvider(mode: EngineMode) {
  return providers[mode];
}

export function getProviderDescriptorForItem(itemID?: number) {
  const mode =
    typeof itemID === "number" ? getModeForItem(itemID) : getDefaultMode();
  return getProvider(mode).getDescriptor();
}
