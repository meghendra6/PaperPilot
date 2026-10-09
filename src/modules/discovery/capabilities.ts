import type { EngineMode } from "../ai/types";
import type { DiscoveryCapabilities } from "./types";
import { getProvider } from "../ai/providerRegistry";

/** The engine-settings toggle name, shared by the pane and discovery errors. */
export const WEB_SEARCH_SETTING_LABEL = "Allow web search when needed";

export type DiscoveryAvailability =
  | { available: true }
  | { available: false; reason: string };

export function getDiscoveryCapabilities(
  mode: EngineMode,
): DiscoveryCapabilities {
  return getProvider(mode).getDescriptor().discoveryCapabilities;
}

export function canRunDiscovery(capabilities: DiscoveryCapabilities) {
  // Bibliographic providers do not discover authoritative track/decision pages.
  // Until Paper Pilot pre-collects that evidence itself, the agent must have a
  // live public-web path so an unseen venue can be verified without guessing.
  return capabilities.agentWebSearch && capabilities.officialEvidenceFetch;
}

/** Explains, in one short line, why discovery cannot start on this engine. */
export function describeDiscoveryAvailability(
  mode: EngineMode,
  capabilities: DiscoveryCapabilities,
): DiscoveryAvailability {
  if (canRunDiscovery(capabilities)) return { available: true };
  if (mode !== "codex_cli") {
    return {
      available: false,
      reason: "Needs Codex CLI with web search allowed (engine settings).",
    };
  }
  if (!capabilities.agentWebSearch) {
    return {
      available: false,
      reason: `Needs web search: turn on “${WEB_SEARCH_SETTING_LABEL}” in engine settings.`,
    };
  }
  return {
    available: false,
    reason: "Needs network access that this Zotero window does not provide.",
  };
}

export function getDiscoveryAvailability(
  mode: EngineMode,
): DiscoveryAvailability {
  return describeDiscoveryAvailability(mode, getDiscoveryCapabilities(mode));
}

/** Error text for a workflow that requires live web search on this engine. */
export function buildWebSearchRequiredMessage(
  task: string,
  mode: EngineMode,
): string {
  return mode === "codex_cli"
    ? `${task} needs web search. Turn on “${WEB_SEARCH_SETTING_LABEL}” in engine settings and try again.`
    : `${task} needs Codex CLI with web search. Switch to Codex CLI and turn on “${WEB_SEARCH_SETTING_LABEL}” in engine settings.`;
}
