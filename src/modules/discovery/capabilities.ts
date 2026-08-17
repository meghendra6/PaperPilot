import type { EngineMode } from "../ai/types";
import type { DiscoveryCapabilities } from "./types";
import { getProvider } from "../ai/providerRegistry";

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
