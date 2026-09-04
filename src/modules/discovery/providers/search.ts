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

function boundedSearchTerms(value: string, maxLength: number) {
  const withoutSensitiveTokens = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b\S+@\S+\b/g, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const terms = withoutSensitiveTokens.split(" ").filter(Boolean).slice(0, 18);
  let output = "";
  for (const term of terms) {
    const next = output ? `${output} ${term}` : term;
    if (next.length > maxLength) break;
    output = next;
  }
  return output;
}

export function buildStructuredSeedQueries(params: {
  title: string;
  concern?: string;
  concernOrigin?: import("../types").ResearchConcernOrigin;
}) {
  const title = boundedSearchTerms(params.title, 160);
  const concern =
    params.concern && params.concernOrigin !== "selection"
      ? boundedSearchTerms(params.concern, 180)
      : undefined;
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
  deadline: number;
  now: () => number;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (params.signal?.aborted)
        throw new Error("Research discovery cancelled.");
      const remaining = params.deadline - params.now();
      if (remaining <= 0) throw new Error("Research discovery timed out.");
      return await params.provider.search(params.query, {
        fetch: withDiscoveryFetchTimeout(
          params.fetch,
          Math.min(15_000, remaining),
          params.signal,
        ),
        limit: params.limit,
      });
    } catch (error) {
      lastError = error;
      if (params.signal?.aborted) throw error;
      const status = Number(
        (error as { status?: unknown } | undefined)?.status,
      );
      if (status >= 400 && status < 500) throw error;
      if (params.now() >= params.deadline) throw error;
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
  deadline?: number;
}) {
  const query = params.query.replace(/\s+/g, " ").trim();
  if (!query)
    return { candidates: [], limitations: ["Search query was empty."] };
  const providers = params.providers || BUILT_IN_CANDIDATE_PROVIDERS;
  const clock = params.now ?? Date.now;
  const now = clock();
  const deadline = params.deadline ?? now + 60_000;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
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
          deadline,
          now: clock,
        });
        cache.set(key, {
          expiresAt: now + 5 * 60_000,
          candidates,
        });
        while (cache.size > 128) {
          const oldest = cache.keys().next().value as string | undefined;
          if (!oldest) break;
          cache.delete(oldest);
        }
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
