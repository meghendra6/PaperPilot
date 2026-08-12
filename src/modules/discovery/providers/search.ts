import { deduplicateProviderCandidates } from "../normalize";
import type { DiscoveryProviderCandidate } from "../types";
import { BUILT_IN_CANDIDATE_PROVIDERS } from "./scholarly";
import {
  type CandidateSearchProvider,
  type DiscoveryFetch,
  withDiscoveryFetchTimeout,
} from "./types";

const cache = new Map<
  string,
  { expiresAt: number; candidates: DiscoveryProviderCandidate[] }
>();

export function buildStructuredSeedQueries(params: {
  title: string;
  concern?: string;
}) {
  const title = params.title.replace(/\s+/g, " ").trim();
  const concern = params.concern?.replace(/\s+/g, " ").trim();
  const focus = concern || title;
  const seeds = [
    { family: "problem_setting", query: focus },
    {
      family: "method_mechanism",
      query: `${title} method mechanism approach`,
    },
    {
      family: "evaluation",
      query: `${title} evaluation benchmark results`,
    },
    {
      family: "alternatives_recent",
      query: `${focus} limitations alternatives recent prior work`,
    },
  ];
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    const normalized = seed.query.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

async function searchWithRetry(params: {
  provider: CandidateSearchProvider;
  query: string;
  fetch?: DiscoveryFetch;
  limit: number;
  signal?: AbortSignal;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (params.signal?.aborted)
        throw new Error("Research discovery cancelled.");
      return await params.provider.search(params.query, {
        fetch: withDiscoveryFetchTimeout(params.fetch, 15_000, params.signal),
        limit: params.limit,
      });
    } catch (error) {
      lastError = error;
      if (params.signal?.aborted) throw error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export async function searchCandidateProviders(params: {
  query: string;
  providers?: CandidateSearchProvider[];
  fetch?: DiscoveryFetch;
  limitPerProvider?: number;
  now?: () => number;
  signal?: AbortSignal;
}) {
  const query = params.query.replace(/\s+/g, " ").trim();
  if (!query)
    return { candidates: [], limitations: ["Search query was empty."] };
  const providers = params.providers || BUILT_IN_CANDIDATE_PROVIDERS;
  const now = params.now?.() ?? Date.now();
  const results = await Promise.all(
    providers.map(async (provider) => {
      if (params.signal?.aborted)
        throw new Error("Research discovery cancelled.");
      const key = `${provider.id}:${query.toLowerCase()}:${params.limitPerProvider || 10}`;
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) {
        return { candidates: cached.candidates, limitation: undefined };
      }
      try {
        const candidates = await searchWithRetry({
          provider,
          query,
          fetch: params.fetch,
          limit: params.limitPerProvider || 10,
          signal: params.signal,
        });
        cache.set(key, {
          expiresAt: now + 5 * 60_000,
          candidates,
        });
        return { candidates, limitation: undefined };
      } catch (error) {
        if (params.signal?.aborted) throw error;
        return {
          candidates: [],
          limitation: `${provider.id} unavailable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );

  return {
    candidates: deduplicateProviderCandidates(
      results.flatMap((result) => result.candidates),
    ),
    limitations: results.flatMap((result) =>
      result.limitation ? [result.limitation] : [],
    ),
  };
}

export function clearDiscoveryProviderCache() {
  cache.clear();
}
