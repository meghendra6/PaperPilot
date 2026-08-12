import type { EngineMode } from "../ai/types";
import type { DiscoveryCapabilities } from "./types";
import { getProvider } from "../ai/providerRegistry";

export function getDiscoveryCapabilities(
  mode: EngineMode,
): DiscoveryCapabilities {
  return getProvider(mode).getDescriptor().discoveryCapabilities;
}

export function canRunDiscovery(capabilities: DiscoveryCapabilities) {
  return (
    capabilities.agentWebSearch ||
    (capabilities.structuredCandidateSearch &&
      capabilities.officialEvidenceFetch)
  );
}
