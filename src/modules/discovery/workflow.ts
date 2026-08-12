import { parseDiscoveryResult } from "./parser";
import { normalizeDiscoveryTitle } from "./normalize";
import { inspectOfficialEvidenceURL } from "./providers/officialEvidence";
import type { DiscoveryFetch } from "./providers/types";
import type { DiscoveryResult, PublicationEvidence } from "./types";

const DIRECT_TYPES = new Set<PublicationEvidence["type"]>([
  "official_proceedings",
  "official_program",
  "official_decision",
  "publisher_proceedings",
  "official_anthology",
]);

async function inspectWithRetry(
  url: string,
  fetcher?: DiscoveryFetch,
  signal?: AbortSignal,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (signal?.aborted) throw new Error("Research discovery cancelled.");
      return await inspectOfficialEvidenceURL({
        url,
        fetch: fetcher,
        signal,
      });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
  throw lastError;
}

export async function verifyDiscoveryEvidenceLive(params: {
  discovery: DiscoveryResult;
  fetch?: DiscoveryFetch;
  signal?: AbortSignal;
}) {
  const evidenceInspections = new Map<
    string,
    Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>
  >();
  const failures: string[] = [];
  const allPapers = [
    ...params.discovery.verifiedMain,
    ...params.discovery.otherPeerReviewed,
    ...params.discovery.noveltyRadar,
  ];
  const urls = [
    ...new Set(
      allPapers.flatMap((paper) =>
        paper.publicationEvidence
          .filter((entry) => DIRECT_TYPES.has(entry.type))
          .map((entry) => entry.url),
      ),
    ),
  ];

  for (const url of urls) {
    try {
      evidenceInspections.set(
        url,
        await inspectWithRetry(url, params.fetch, params.signal),
      );
    } catch (error) {
      if (params.signal?.aborted) throw error;
      failures.push(
        `${url}: ${error instanceof Error ? error.message : "unavailable"}`,
      );
    }
  }

  const papersWithLiveEvidence = allPapers.map((paper) => ({
    ...paper,
    publicationEvidence: paper.publicationEvidence.filter((entry) => {
      if (!DIRECT_TYPES.has(entry.type)) return true;
      const inspection = evidenceInspections.get(entry.url);
      if (!inspection?.bodyInspected) return false;
      const observedPage = normalizeDiscoveryTitle(
        [inspection.pageTitle, inspection.searchableText]
          .filter(Boolean)
          .join(" "),
      );
      const expectedTitle = normalizeDiscoveryTitle(paper.title);
      const titleMatched =
        expectedTitle.length > 0 && observedPage.includes(expectedTitle);
      if (!titleMatched) {
        failures.push(
          `${entry.url}: official page did not match “${paper.title}”.`,
        );
      }
      return titleMatched;
    }),
  }));

  const verifiedPayload = {
    ...params.discovery,
    verifiedMain: papersWithLiveEvidence,
    otherPeerReviewed: [],
    noveltyRadar: [],
    limitations: [
      ...params.discovery.limitations,
      ...(failures.length
        ? [
            "Publication status could not be verified for one or more official sources during live recheck.",
            ...failures.slice(0, 8),
          ]
        : []),
    ],
  };
  return parseDiscoveryResult(JSON.stringify(verifiedPayload));
}
