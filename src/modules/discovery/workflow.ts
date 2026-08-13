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

const NON_MAIN_TRACKS = [
  [/findings/i, "Findings"],
  [/workshop/i, "Workshop"],
  [/\b(demo|demonstration)\b/i, "Demo"],
  [/industry/i, "Industry track"],
  [/shared[ -]?task/i, "Shared task"],
  [/tutorial|extended abstract|doctoral consortium/i, "Tutorial or abstract"],
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsNormalized(haystack: string, needle: string) {
  const normalizedNeedle = normalizeDiscoveryTitle(needle);
  return (
    normalizedNeedle.length > 0 &&
    normalizeDiscoveryTitle(haystack).includes(normalizedNeedle)
  );
}

function titleVariants(title: string) {
  return [title, title.replace(/\([^)]*\)/g, " ")]
    .map((value) =>
      value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .filter(
      (value, index, values) =>
        value.length >= 8 && values.indexOf(value) === index,
    );
}

function pageMatchesPaperTitle(page: string, title: string) {
  const normalizedPage = page
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return titleVariants(title).some((variant) =>
    normalizedPage.includes(variant),
  );
}

function observedVenue(
  paper: DiscoveryResult["verifiedMain"][number],
  page: string,
) {
  for (const candidate of [
    paper.venueName,
    paper.venueAcronym,
    paper.leadingVenueAssessment.venueName,
    paper.leadingVenueAssessment.venueAcronym,
  ]) {
    if (candidate && containsNormalized(page, candidate)) {
      // parseDiscoveryResult has already bound the paper metadata and the
      // per-paper assessment to one canonical plan entry. Preserve that
      // identity in reconstructed evidence instead of reintroducing a page
      // alias (for example, "ISCA 2007") that can spuriously conflict with
      // the plan's full venue name during the post-verification parse.
      return (
        paper.leadingVenueAssessment.venueName ||
        paper.leadingVenueAssessment.venueAcronym ||
        candidate
      );
    }
  }
  return undefined;
}

function hostnameMatchesVenueAuthority(
  hostname: string,
  paper: DiscoveryResult["verifiedMain"][number],
) {
  const hostLabels = hostname
    .toLowerCase()
    .split(".")
    .map((label) => label.replace(/[^a-z0-9]+/g, ""));
  const venueKeys = [
    paper.venueAcronym,
    paper.leadingVenueAssessment.venueAcronym,
    paper.venueName,
    paper.leadingVenueAssessment.venueName,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      const normalized = normalizeDiscoveryTitle(value);
      const words = normalized
        .split(" ")
        .filter(
          (part) =>
            part &&
            ![
              "conference",
              "symposium",
              "proceedings",
              "international",
            ].includes(part),
        );
      return [
        normalized.replace(/[^a-z0-9]+/g, ""),
        words.length >= 2 ? words.map((word) => word[0]).join("") : "",
      ];
    })
    .filter((value) => value.length >= 3);
  return venueKeys.some((key) =>
    hostLabels.some((label) =>
      [key, `${key}conf`, `${key}conference`, `${key}org`].includes(label),
    ),
  );
}

function hasGenericSourceAuthority(
  inspection: Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>,
  paper: DiscoveryResult["verifiedMain"][number],
) {
  const parsed = new URL(inspection.url);
  const header = `${inspection.pageTitle || ""} ${inspection.searchableText.slice(0, 800)}`;
  const venueObserved = observedVenue(paper, header);
  const structuralPath =
    /(?:^|\/)(?:program|programme|schedule|proceedings|accepted(?:-papers?)?|decisions?)(?:[/.\-_]|$)/i.test(
      parsed.pathname,
    );
  const structuralHeader =
    /\b(program|programme|schedule|proceedings|accepted papers|conference decision)\b/i.test(
      header,
    );
  return Boolean(
    venueObserved &&
      structuralPath &&
      structuralHeader &&
      hostnameMatchesVenueAuthority(inspection.hostname, paper),
  );
}

function inferEvidenceType(
  inspection: Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>,
): PublicationEvidence["type"] | undefined {
  const known = inspection.sourceFamily;
  if (known === "openreview") return "official_decision";
  if (known === "acl-anthology") return "official_anthology";
  if (["acm", "ieee", "springer"].includes(known)) {
    return "publisher_proceedings";
  }
  if (["pmlr", "cvf", "neurips", "usenix"].includes(known)) {
    return "official_proceedings";
  }
  const page = `${inspection.pageTitle || ""} ${inspection.searchableText}`;
  if (/\b(program|programme|schedule)\b/i.test(page)) return "official_program";
  if (
    /\b(decision|accept(?:ed|ance)?|reject(?:ed|ion)?|withdrawn?)\b/i.test(page)
  ) {
    return "official_decision";
  }
  if (/\b(proceedings|anthology)\b/i.test(page)) return "official_proceedings";
  return undefined;
}

function inferTrack(page: string, url: string) {
  const combined = `${page} ${url}`;
  for (const [pattern, label] of NON_MAIN_TRACKS) {
    if (pattern.test(combined)) return { label, main: false };
  }
  if (
    /\bmain(?: conference| track| program| programme)?\b|\bresearch track\b|\b(?:long|short) papers?\b/i.test(
      combined,
    ) ||
    /aclanthology\.org\/(?:\d{4}\.)?(?:acl|emnlp|naacl)-(?:long|short)\./i.test(
      url,
    )
  ) {
    return { label: "Main conference", main: true };
  }
  return undefined;
}

function titleIndex(page: string, title: string) {
  const words = title
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 6);
  const pattern = words?.length
    ? new RegExp(words.map(escapeRegExp).join("[^\\p{L}\\p{N}]+"), "iu")
    : undefined;
  return pattern ? page.search(pattern) : -1;
}

function inferEntryBoundTrack(params: {
  page: string;
  title: string;
  url: string;
  type: PublicationEvidence["type"];
  sourceFamily: string;
}) {
  const index = titleIndex(params.page, params.title);
  const entryContext =
    index < 0
      ? params.page
      : params.page.slice(
          Math.max(0, index - 1_600),
          index + params.title.length + 1_600,
        );
  const local = inferTrack(entryContext, params.url);
  if (local?.main === false) return local;

  const prefix = index < 0 ? params.page : params.page.slice(0, index);
  const trackScopePattern =
    /\b(main|technical) (?:conference )?(?:program|programme)|\b(?:workshop|findings|demo(?:nstration)?|industry track|shared[ -]?task|tutorial|doctoral consortium)\b/gi;
  let nearestTrackScope = "";
  for (const match of prefix.matchAll(trackScopePattern)) {
    nearestTrackScope = match[0];
  }
  const scoped = inferTrack(nearestTrackScope, params.url);
  if (scoped) return scoped;

  const sessionPattern = /\bsession\s+[\w.-]+/gi;
  let nearestSession = "";
  for (const match of prefix.matchAll(sessionPattern))
    nearestSession = match[0];

  const headerMain =
    /\b(main|technical) (?:conference )?(?:program|programme)\b/i.test(
      params.page.slice(0, 800),
    );
  if (nearestSession && headerMain) {
    return { label: "Main program", main: true };
  }
  if (
    params.sourceFamily !== "generic-official-web" &&
    /\b(?:accepted )?(?:oral|poster|spotlight)\b/i.test(entryContext) &&
    !NON_MAIN_TRACKS.some(([pattern]) =>
      pattern.test(`${prefix} ${params.url}`),
    )
  ) {
    return { label: "Main conference oral/poster", main: true };
  }
  if (local?.main === true) return local;
  return undefined;
}

function inferDecision(page: string) {
  if (/\b(reject(?:ed|ion)?|withdrawn?|retracted?)\b/i.test(page)) {
    return { label: "Rejected or withdrawn", accepted: false };
  }
  if (/\b(accept(?:ed|ance)?|published|archival proceedings)\b/i.test(page)) {
    return { label: "Accepted or published", accepted: true };
  }
  return undefined;
}

function authorIdentityKeys(authors: string[]) {
  return authors
    .map((author) => {
      const words = normalizeDiscoveryTitle(author).split(" ").filter(Boolean);
      return words.at(-1) || "";
    })
    .filter((key) => key.length >= 3);
}

function pageMatchesPaperIdentity(
  page: string,
  paper: DiscoveryResult["verifiedMain"][number],
) {
  if (!pageMatchesPaperTitle(page, paper.title)) return false;
  const normalizedPage = normalizeDiscoveryTitle(page);
  const normalizedRaw = page.toLowerCase();
  const doiMatch = paper.doi && normalizedRaw.includes(paper.doi.toLowerCase());
  if (doiMatch) return true;
  if (!paper.year || !new RegExp(`\\b${paper.year}\\b`).test(normalizedPage)) {
    return false;
  }
  const authorKeys = authorIdentityKeys(paper.authors);
  if (!authorKeys.length) return false;
  const requiredMatches = Math.min(2, authorKeys.length);
  const observedMatches = authorKeys.filter((key) =>
    new RegExp(`(?:^| )${escapeRegExp(key)}(?: |$)`, "u").test(normalizedPage),
  ).length;
  return observedMatches >= requiredMatches;
}

function paperEvidenceContext(page: string, title: string) {
  const index = titleIndex(page, title);
  if (index < 0) return page;
  return page.slice(Math.max(0, index - 1_200), index + title.length + 1_200);
}

export function reconstructOfficialEvidence(
  paper: DiscoveryResult["verifiedMain"][number],
  inspection: Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>,
): PublicationEvidence | undefined {
  if (!inspection.bodyInspected) return undefined;
  const page = [inspection.pageTitle, inspection.searchableText]
    .filter(Boolean)
    .join(" ");
  if (!pageMatchesPaperIdentity(`${page} ${inspection.url}`, paper)) {
    return undefined;
  }
  const venue = observedVenue(paper, page);
  // A venue-bearing claim must be corroborated on the inspected paper page.
  if ((paper.venueName || paper.venueAcronym) && !venue) return undefined;
  const type = inferEvidenceType(inspection);
  if (!type) return undefined;
  if (
    inspection.sourceFamily === "generic-official-web" &&
    !hasGenericSourceAuthority(inspection, paper)
  ) {
    return undefined;
  }
  if (
    inspection.sourceFamily === "generic-official-web" &&
    type === "official_decision"
  ) {
    // Open-world verification is supported through venue-owned programs and
    // proceedings. A generic prose acceptance claim is not an official
    // decision surface and remains ambiguous.
    return undefined;
  }
  const context = paperEvidenceContext(page, paper.title);
  const resolvedTrack = inferEntryBoundTrack({
    page,
    title: paper.title,
    url: inspection.url,
    type,
    sourceFamily: inspection.sourceFamily,
  });
  const decision = inferDecision(context);
  const supports: PublicationEvidence["supports"] = ["identity"];
  if (
    decision?.accepted ||
    [
      "official_proceedings",
      "publisher_proceedings",
      "official_anthology",
    ].includes(type)
  ) {
    supports.push("published");
  }
  if (
    decision?.accepted ||
    (type === "official_program" && resolvedTrack?.main === true)
  ) {
    supports.push("accepted");
  }
  if (resolvedTrack?.main) supports.push("main_track");
  if (
    inspection.sourceFamily === "openreview" &&
    /\b(review|forum|meta-review|decision)\b/i.test(page)
  ) {
    supports.push("reviews_available");
  }
  return {
    type,
    sourceName:
      inspection.sourceFamily === "generic-official-web"
        ? `Official source (${inspection.hostname})`
        : inspection.sourceFamily,
    url: inspection.url,
    observedTitle: paper.title,
    observedVenue: venue,
    observedTrack: resolvedTrack?.label,
    observedDecision:
      decision?.label ||
      (type === "official_program" && resolvedTrack?.main === true
        ? "Listed in official program"
        : undefined),
    checkedAt: inspection.checkedAt,
    supports,
  };
}

async function inspectWithRetry(
  url: string,
  fetcher?: DiscoveryFetch,
  signal?: AbortSignal,
  deadline = Date.now() + 30_000,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (signal?.aborted) throw new Error("Research discovery cancelled.");
      if (Date.now() >= deadline)
        throw new Error("Research discovery timed out.");
      return await inspectOfficialEvidenceURL({
        url,
        fetch: fetcher,
        signal,
        deadline,
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
  deadline?: number;
}) {
  const deadline = params.deadline ?? Date.now() + 60_000;
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
        await inspectWithRetry(url, params.fetch, params.signal, deadline),
      );
    } catch (error) {
      if (params.signal?.aborted) throw error;
      failures.push(
        `${url}: ${error instanceof Error ? error.message : "unavailable"}`,
      );
    }
  }

  const papersWithLiveEvidence = allPapers.map((paper) => {
    const reconstructed = paper.publicationEvidence
      .filter((entry) => DIRECT_TYPES.has(entry.type))
      .flatMap((entry) => {
        const inspection = evidenceInspections.get(entry.url);
        const evidence = inspection
          ? reconstructOfficialEvidence(paper, inspection)
          : undefined;
        if (!evidence) {
          failures.push(
            `${entry.url}: official page did not independently verify the title, venue, track, and decision for “${paper.title}”.`,
          );
        }
        return evidence ? [evidence] : [];
      });
    const verifiedReviewURL = reconstructed.find((entry) =>
      entry.supports.includes("reviews_available"),
    )?.url;
    return {
      ...paper,
      track: reconstructed.find((entry) => entry.observedTrack)?.observedTrack,
      reviewURL: verifiedReviewURL,
      reviewInsight: verifiedReviewURL ? paper.reviewInsight : undefined,
      publicationEvidence: reconstructed.length ? reconstructed : [],
    };
  });

  const verifiedPayload = {
    ...params.discovery,
    liveVerification: {
      verifierVersion: 1,
      verifiedAt: new Date().toISOString(),
    },
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
  return parseDiscoveryResult(JSON.stringify(verifiedPayload), {
    allowReviewLinks: true,
    allowLiveVerificationMarker: true,
  });
}
