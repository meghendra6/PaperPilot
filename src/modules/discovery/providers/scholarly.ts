import {
  normalizeDiscoveryDOI,
  normalizeHttpURL,
  normalizeWhitespace,
} from "../normalize";
import type { DiscoveryProviderCandidate } from "../types";
import type { CandidateSearchProvider, DiscoveryFetch } from "./types";

function safeLimit(value?: number) {
  return Math.max(1, Math.min(20, Math.trunc(value || 10)));
}

function authors(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return normalizeWhitespace(entry);
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return normalizeWhitespace(
          String(record.name || record.display_name || record.text || ""),
        );
      }
      return "";
    })
    .filter(Boolean);
}

async function getJson(url: string, fetcher: DiscoveryFetch) {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Scholarly provider request failed (${response.status}).`);
  }
  return (await response.json()) as unknown;
}

export const semanticScholarProvider: CandidateSearchProvider = {
  id: "semantic-scholar",
  async search(query, options) {
    const fetcher = options?.fetch || fetch;
    const limit = safeLimit(options?.limit);
    const fields = [
      "title",
      "authors",
      "year",
      "abstract",
      "venue",
      "url",
      "externalIds",
      "openAccessPdf",
    ].join(",");
    const raw = (await getJson(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
      fetcher,
    )) as { data?: unknown[] };
    return (raw.data || []).flatMap((entry): DiscoveryProviderCandidate[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, any>;
      const title = normalizeWhitespace(String(record.title || ""));
      if (!title || !record.paperId) return [];
      const urls = [record.url, record.openAccessPdf?.url]
        .map((url) =>
          typeof url === "string" ? normalizeHttpURL(url) : undefined,
        )
        .filter((url): url is string => Boolean(url));
      return [
        {
          provider: "semantic-scholar",
          providerID: String(record.paperId),
          title,
          authors: authors(record.authors),
          year: typeof record.year === "number" ? record.year : undefined,
          abstract:
            typeof record.abstract === "string" ? record.abstract : undefined,
          doi:
            typeof record.externalIds?.DOI === "string"
              ? normalizeDiscoveryDOI(record.externalIds.DOI)
              : undefined,
          venueName:
            typeof record.venue === "string" ? record.venue : undefined,
          urls,
        } satisfies DiscoveryProviderCandidate,
      ];
    });
  },
};

export const openAlexProvider: CandidateSearchProvider = {
  id: "openalex",
  async search(query, options) {
    const fetcher = options?.fetch || fetch;
    const limit = safeLimit(options?.limit);
    const raw = (await getJson(
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`,
      fetcher,
    )) as { results?: unknown[] };
    return (raw.results || []).flatMap(
      (entry): DiscoveryProviderCandidate[] => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, any>;
        const title = normalizeWhitespace(String(record.title || ""));
        if (!title || !record.id) return [];
        const landingPage = record.primary_location?.landing_page_url;
        const urls = [record.id, landingPage]
          .map((url) =>
            typeof url === "string" ? normalizeHttpURL(url) : undefined,
          )
          .filter((url): url is string => Boolean(url));
        return [
          {
            provider: "openalex",
            providerID: String(record.id).replace(
              /^https:\/\/openalex\.org\//,
              "",
            ),
            title,
            authors: authors(
              Array.isArray(record.authorships)
                ? record.authorships.map((value: any) => value.author)
                : [],
            ),
            year:
              typeof record.publication_year === "number"
                ? record.publication_year
                : undefined,
            doi:
              typeof record.doi === "string"
                ? normalizeDiscoveryDOI(record.doi)
                : undefined,
            venueName:
              typeof record.primary_location?.source?.display_name === "string"
                ? record.primary_location.source.display_name
                : undefined,
            urls,
          } satisfies DiscoveryProviderCandidate,
        ];
      },
    );
  },
};

export const dblpProvider: CandidateSearchProvider = {
  id: "dblp",
  async search(query, options) {
    const fetcher = options?.fetch || fetch;
    const limit = safeLimit(options?.limit);
    const raw = (await getJson(
      `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&h=${limit}&format=json`,
      fetcher,
    )) as any;
    const hits = raw?.result?.hits?.hit;
    return (Array.isArray(hits) ? hits : []).flatMap(
      (entry: any): DiscoveryProviderCandidate[] => {
        const info = entry?.info || {};
        const title = normalizeWhitespace(
          String(info.title || "").replace(/<[^>]+>/g, ""),
        );
        if (!title || !info.key) return [];
        const authorValue = info.authors?.author;
        const urls = [info.url, info.ee]
          .flatMap((url) => (Array.isArray(url) ? url : [url]))
          .map((url) =>
            typeof url === "string" ? normalizeHttpURL(url) : undefined,
          )
          .filter((url): url is string => Boolean(url));
        return [
          {
            provider: "dblp",
            providerID: String(info.key),
            title,
            authors: authors(
              Array.isArray(authorValue)
                ? authorValue
                : authorValue
                  ? [authorValue]
                  : [],
            ),
            year: /^\d{4}$/.test(String(info.year || ""))
              ? Number(info.year)
              : undefined,
            venueName: typeof info.venue === "string" ? info.venue : undefined,
            urls,
          } satisfies DiscoveryProviderCandidate,
        ];
      },
    );
  },
};

export const crossrefProvider: CandidateSearchProvider = {
  id: "crossref",
  async search(query, options) {
    const fetcher = options?.fetch || fetch;
    const limit = safeLimit(options?.limit);
    const raw = (await getJson(
      `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}`,
      fetcher,
    )) as any;
    const items = raw?.message?.items;
    return (Array.isArray(items) ? items : []).flatMap(
      (record: any): DiscoveryProviderCandidate[] => {
        const title = normalizeWhitespace(
          String(
            Array.isArray(record.title) ? record.title[0] : record.title || "",
          ),
        );
        if (!title || !record.DOI) return [];
        const dateParts = record.published?.["date-parts"]?.[0];
        const urls = [record.URL]
          .map((url) =>
            typeof url === "string" ? normalizeHttpURL(url) : undefined,
          )
          .filter((url): url is string => Boolean(url));
        return [
          {
            provider: "crossref",
            providerID: String(record.DOI),
            title,
            authors: Array.isArray(record.author)
              ? record.author
                  .map((entry: any) =>
                    normalizeWhitespace(
                      [entry.given, entry.family].filter(Boolean).join(" "),
                    ),
                  )
                  .filter(Boolean)
              : [],
            year:
              Array.isArray(dateParts) && typeof dateParts[0] === "number"
                ? dateParts[0]
                : undefined,
            doi: normalizeDiscoveryDOI(String(record.DOI)),
            venueName: Array.isArray(record["container-title"])
              ? record["container-title"][0]
              : undefined,
            urls,
          } satisfies DiscoveryProviderCandidate,
        ];
      },
    );
  },
};

export const BUILT_IN_CANDIDATE_PROVIDERS = [
  semanticScholarProvider,
  openAlexProvider,
  dblpProvider,
  crossrefProvider,
];
