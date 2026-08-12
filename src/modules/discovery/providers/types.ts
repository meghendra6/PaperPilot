import type {
  DiscoveredPaper,
  DiscoveryProviderCandidate,
  PublicationEvidence,
} from "../types";

export type DiscoveryFetch = typeof fetch;

export function withDiscoveryFetchTimeout(
  fetcher: DiscoveryFetch = fetch,
  timeoutMs = 15_000,
  outerSignal?: AbortSignal,
): DiscoveryFetch {
  return (async (input, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const sourceSignal = init.signal;
    const abortFromSource = () => controller.abort();
    const abortFromOuter = () => controller.abort();
    sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
    outerSignal?.addEventListener("abort", abortFromOuter, { once: true });
    if (sourceSignal?.aborted) controller.abort();
    if (outerSignal?.aborted) controller.abort();
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      sourceSignal?.removeEventListener("abort", abortFromSource);
      outerSignal?.removeEventListener("abort", abortFromOuter);
    }
  }) as DiscoveryFetch;
}

export interface CandidateSearchProvider {
  id: string;
  search(
    query: string,
    options?: { limit?: number; fetch?: DiscoveryFetch },
  ): Promise<DiscoveryProviderCandidate[]>;
}

export interface PublicationEvidenceProvider {
  id: string;
  canHandle(candidate: DiscoveredPaper): boolean;
  collect(
    candidate: DiscoveredPaper,
    options?: { fetch?: DiscoveryFetch },
  ): Promise<PublicationEvidence[]>;
}
