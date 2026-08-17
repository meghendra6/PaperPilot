import { parseDiscoveryResult } from "./parser";
import { areLikelySamePaper, normalizeDiscoveryTitle } from "./normalize";
import { inspectOfficialEvidenceURL } from "./providers/officialEvidence";
import type { DiscoveryFetch } from "./providers/types";
import type {
  DiscoveryProviderCandidate,
  DiscoveryResult,
  PublicationEvidence,
} from "./types";

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
  if (!normalizedNeedle) return false;
  const normalizedHaystack = normalizeDiscoveryTitle(haystack);
  return new RegExp(
    `(?:^| )${escapeRegExp(normalizedNeedle).replace(/ /g, " +")}(?: |$)`,
    "u",
  ).test(normalizedHaystack);
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
        value.length >= 3 && values.indexOf(value) === index,
    );
}

function pageMatchesPaperTitle(page: string, title: string) {
  const normalizedPage = page
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return titleVariants(title).some((variant) =>
    new RegExp(
      `(?:^| )${escapeRegExp(variant).replace(/ /g, " +")}(?: |$)`,
      "u",
    ).test(normalizedPage),
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

function hasGenericSourceAuthority(
  inspection: Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>,
  paper: DiscoveryResult["verifiedMain"][number],
  authorityValidated: boolean,
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
    venueObserved && authorityValidated && structuralPath && structuralHeader,
  );
}

const SHARED_SECOND_LEVEL_LABELS = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "or",
  "org",
]);

function registrableDomainLabel(hostname: string) {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] || "";
  const secondLevel = labels[labels.length - 2];
  const usesSharedSecondLevel =
    labels.length >= 3 &&
    secondLevel.length <= 3 &&
    SHARED_SECOND_LEVEL_LABELS.has(secondLevel);
  return usesSharedSecondLevel ? labels[labels.length - 3] : secondLevel;
}

function hasVenueNamedDomainAuthority(
  inspection: Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>,
  paper: DiscoveryResult["verifiedMain"][number],
) {
  const venueName =
    paper.venueName || paper.leadingVenueAssessment.venueName || "";
  const meaningfulWords = normalizeDiscoveryTitle(venueName)
    .split(" ")
    .filter(
      (word) =>
        word.length >= 3 &&
        ![
          "the",
          "and",
          "international",
          "annual",
          "conference",
          "symposium",
          "workshop",
          "proceedings",
        ].includes(word),
    );
  // Subdomain and path labels are attacker-choosable on shared hosts, so only
  // the registered domain label itself may prove venue ownership, and it must
  // equal the venue identity instead of merely containing it.
  const ownerLabel = registrableDomainLabel(inspection.hostname).replace(
    /[^a-z0-9]/g,
    "",
  );
  const ownerLabelWithoutYear = ownerLabel.replace(/[0-9]+/g, "");
  const joinedName = meaningfulWords.join("");
  const nameBound =
    meaningfulWords.length >= 2 &&
    (ownerLabel === joinedName || ownerLabelWithoutYear === joinedName);
  const acronym = (
    paper.venueAcronym ||
    paper.leadingVenueAssessment.venueAcronym ||
    ""
  )
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const acronymBound =
    acronym.length >= 3 &&
    (ownerLabel === acronym || ownerLabelWithoutYear === acronym);
  const titleNamesVenue = containsNormalized(
    inspection.pageTitle || "",
    venueName,
  );
  return titleNamesVenue && (nameBound || acronymBound);
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
  if (known === "isca") return "official_program";
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

function titleMatches(page: string, title: string) {
  const words = title
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(0, 6);
  if (!words?.length) return [];
  return [
    ...page.matchAll(
      new RegExp(words.map(escapeRegExp).join("[^\\p{L}\\p{N}]+"), "giu"),
    ),
  ];
}

function titleIndex(page: string, title: string) {
  return titleMatches(page, title)[0]?.index ?? -1;
}

function inferEntryBoundTrack(params: {
  page: string;
  entryContext: string;
  titleIndex: number;
  title: string;
  url: string;
  type: PublicationEvidence["type"];
  sourceFamily: string;
}) {
  const index = params.titleIndex;
  const entryContext = params.entryContext;
  const local = inferTrack(entryContext, params.url);
  if (local?.main === false) return local;

  const titleOffset = Math.max(0, titleIndex(entryContext, params.title));
  const afterTitle = entryContext.slice(
    titleOffset + params.title.length,
    titleOffset + params.title.length + 500,
  );
  const explicitEntryTrack =
    /\b(?:track|category|program(?:me)? entry)\s*[:—-]\s*(?:main(?: conference)?|research|technical)(?: track| program(?:me)?)?\b/i.test(
      afterTitle,
    );
  if (explicitEntryTrack) return { label: "Main conference", main: true };

  const prefix = index < 0 ? params.page : params.page.slice(0, index);
  const trackScopePattern =
    /\b(main|technical) (?:conference )?(?:program|programme)|\b(?:workshop|findings|demo(?:nstration)?|industry track|shared[ -]?task|tutorial|doctoral consortium)\b/gi;
  let nearestTrackScope = "";
  for (const match of prefix.matchAll(trackScopePattern)) {
    nearestTrackScope = match[0];
  }
  const scoped = inferTrack(nearestTrackScope, params.url);
  if (scoped?.main === false) return scoped;

  const sessionPattern = /\bsession\s+[\w.-]+/gi;
  let nearestSession = "";
  for (const match of prefix.matchAll(sessionPattern))
    nearestSession = match[0];

  const headerMain =
    /\b(main|technical) (?:conference )?(?:program|programme)\b/i.test(
      params.page.slice(0, 800),
    );
  const nearestScopeIndex = prefix.lastIndexOf(nearestTrackScope);
  const nearestSessionIndex = prefix.lastIndexOf(nearestSession);
  if (
    nearestSession &&
    headerMain &&
    scoped?.main === true &&
    nearestScopeIndex >= 0 &&
    nearestSessionIndex > nearestScopeIndex &&
    index - nearestSessionIndex <= 800
  ) {
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
  if (
    params.sourceFamily === "acl-anthology" &&
    /aclanthology\.org\/(?:\d{4}\.)?(?:acl|emnlp|naacl)-(?:long|short)\./i.test(
      params.url,
    )
  ) {
    return local;
  }
  if (
    params.sourceFamily === "openreview" &&
    local?.main === true &&
    /\b(?:accept(?:ed|ance)?|decision)\b/i.test(entryContext)
  ) {
    return local;
  }
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

function inferStructuredOpenReviewStatus(page: string) {
  const decisionMatch = page.match(
    /\b(?:official decision|decision|recommendation)\s*[:—-]\s*(accept(?:ed|ance)?|reject(?:ed|ion)?|withdrawn?)\b/i,
  );
  const venueMatch = page.match(
    /\b(?:venue|presentation type|track)\s*[:—-]\s*([^|\n]{1,100})/i,
  );
  const decisionValue = decisionMatch?.[1] || "";
  const venueValue = venueMatch?.[1]?.trim() || "";
  const explicitDecisionTrack = page.match(
    /\b(?:official decision|decision)\s*[:—-]\s*(?:accept(?:ed|ance)?)[^|\n]{0,80}\b(oral|poster|spotlight|main(?: conference| track)?)\b/i,
  )?.[1];
  const rejected = /reject|withdraw/i.test(decisionValue);
  const accepted = /accept/i.test(decisionValue);
  const nonMain = NON_MAIN_TRACKS.find(([pattern]) => pattern.test(venueValue));
  const main =
    accepted &&
    !nonMain &&
    /\b(?:main(?: conference| track)?|oral|poster|spotlight|accept(?:ed|ance)?)\b/i.test(
      venueValue,
    );
  return {
    decision: rejected
      ? { label: "Rejected or withdrawn", accepted: false }
      : accepted
        ? { label: "Accepted", accepted: true }
        : undefined,
    track: nonMain
      ? { label: nonMain[1], main: false }
      : main
        ? { label: venueValue, main: true }
        : accepted && explicitDecisionTrack
          ? { label: explicitDecisionTrack, main: true }
          : undefined,
  };
}

function authorIdentityKeys(authors: string[]) {
  return authors
    .map((author) => {
      const words = normalizeDiscoveryTitle(author).split(" ").filter(Boolean);
      return words.at(-1) || "";
    })
    .filter((key) => key.length >= 3);
}

function paperIdentityContext(
  page: string,
  paper: DiscoveryResult["verifiedMain"][number],
  editionContext: string,
) {
  if (!pageMatchesPaperTitle(page, paper.title)) return undefined;
  const matches = titleMatches(page, paper.title);
  const authorKeys = authorIdentityKeys(paper.authors);
  if (!authorKeys.length && !paper.doi) return undefined;
  const requiredMatches = Math.min(2, authorKeys.length);
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
    const match = matches[matchIndex];
    const index = match.index ?? -1;
    if (index < 0) continue;
    const nextMatchIndex = matches[matchIndex + 1]?.index ?? page.length;
    const nextTitleIndex =
      nextMatchIndex - index > match[0].length + 80
        ? nextMatchIndex
        : page.length;
    const context = page.slice(
      Math.max(0, index - 120),
      Math.min(nextTitleIndex, index + match[0].length + 600),
    );
    const normalizedContext = normalizeDiscoveryTitle(context);
    const normalizedRaw = context.toLowerCase();
    const normalizedDOI = paper.doi
      ? paper.doi.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : undefined;
    if (
      normalizedDOI &&
      new RegExp(
        `(?:doi\\s*[:/]\\s*|doi\\.org/)${normalizedDOI}(?=$|[\\s<>"'])`,
        "i",
      ).test(normalizedRaw)
    ) {
      return { context, index };
    }
    if (!paper.year) {
      continue;
    }
    const yearPattern = new RegExp(`\\b${paper.year}\\b`);
    if (
      !yearPattern.test(normalizedContext) &&
      !yearPattern.test(normalizeDiscoveryTitle(editionContext))
    )
      continue;
    const observedMatches = authorKeys.filter((key) =>
      new RegExp(`(?:^| )${escapeRegExp(key)}(?: |$)`, "u").test(
        normalizedContext,
      ),
    ).length;
    if (observedMatches >= requiredMatches) return { context, index };
  }
  return undefined;
}

export function reconstructOfficialEvidence(
  paper: DiscoveryResult["verifiedMain"][number],
  inspection: Awaited<ReturnType<typeof inspectOfficialEvidenceURL>>,
  options: { authorityValidated?: boolean } = {},
): PublicationEvidence | undefined {
  if (!inspection.bodyInspected) return undefined;
  const page = [inspection.pageTitle, inspection.searchableText]
    .filter(Boolean)
    .join(" ");
  const primaryTitleSurface =
    inspection.sourceFamily !== "generic-official-web" &&
    !["openreview", "isca"].includes(inspection.sourceFamily)
      ? inspection.pageTitle || ""
      : page;
  if (
    primaryTitleSurface &&
    !pageMatchesPaperTitle(primaryTitleSurface, paper.title)
  ) {
    return undefined;
  }
  const identity = paperIdentityContext(
    `${page} ${inspection.url}`,
    paper,
    `${inspection.pageTitle || ""} ${inspection.url}`,
  );
  if (!identity) return undefined;
  const venue = observedVenue(paper, page);
  // A venue-bearing claim must be corroborated on the inspected paper page.
  if ((paper.venueName || paper.venueAcronym) && !venue) return undefined;
  const type = inferEvidenceType(inspection);
  if (!type) return undefined;
  if (
    inspection.sourceFamily === "generic-official-web" &&
    !hasGenericSourceAuthority(
      inspection,
      paper,
      options.authorityValidated === true,
    )
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
  const context = identity.context;
  const openReviewStatus =
    inspection.sourceFamily === "openreview"
      ? inferStructuredOpenReviewStatus(context)
      : undefined;
  const resolvedTrack = openReviewStatus
    ? openReviewStatus.track
    : inferEntryBoundTrack({
        page,
        entryContext: context,
        titleIndex: identity.index,
        title: paper.title,
        url: inspection.url,
        type,
        sourceFamily: inspection.sourceFamily,
      });
  const decision =
    openReviewStatus?.decision ||
    (inspection.sourceFamily === "openreview"
      ? undefined
      : inferDecision(context));
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
    new URL(inspection.url).pathname === "/forum" &&
    Boolean(new URL(inspection.url).searchParams.get("id"))
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
  providerCandidates?: DiscoveryProviderCandidate[];
  limitations?: string[];
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
    const providerCandidate = params.providerCandidates?.find((candidate) =>
      areLikelySamePaper(paper, {
        ...candidate,
        providerIDs: { [candidate.provider]: candidate.providerID },
      }),
    );
    const isNovelty = ["preprint_only", "under_review_or_submission"].includes(
      paper.publicationClass,
    );
    const authorityHostnames = new Set(
      paper.publicationEvidence
        .filter((entry) => DIRECT_TYPES.has(entry.type))
        .flatMap((entry) => {
          const inspection = evidenceInspections.get(entry.url);
          if (
            !inspection ||
            inspection.sourceFamily === "generic-official-web"
          ) {
            return [];
          }
          return reconstructOfficialEvidence(paper, inspection)
            ? inspection.linkedHostnames
            : [];
        }),
    );
    const reconstructed = paper.publicationEvidence
      .filter((entry) => DIRECT_TYPES.has(entry.type))
      .flatMap((entry) => {
        const inspection = evidenceInspections.get(entry.url);
        const evidence = inspection
          ? reconstructOfficialEvidence(paper, inspection, {
              authorityValidated:
                inspection.sourceFamily !== "generic-official-web" ||
                authorityHostnames.has(inspection.hostname) ||
                hasVenueNamedDomainAuthority(inspection, paper),
            })
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
    const boundProviderURLs = providerCandidate
      ? providerCandidate.urls.filter((url) => paper.urls.includes(url))
      : [];
    const providerEvidence: PublicationEvidence[] = providerCandidate
      ? providerCandidate.urls.slice(0, 1).map((url) => ({
          type: "scholarly_index" as const,
          sourceName: `Live scholarly provider: ${providerCandidate.provider}`,
          url,
          observedTitle: providerCandidate.title,
          checkedAt: new Date().toISOString(),
          supports: ["identity" as const],
        }))
      : [];
    return {
      ...paper,
      track: reconstructed.find((entry) => entry.observedTrack)?.observedTrack,
      reviewURL: verifiedReviewURL,
      reviewInsight: verifiedReviewURL ? paper.reviewInsight : undefined,
      providerIDs:
        isNovelty && providerCandidate
          ? { [providerCandidate.provider]: providerCandidate.providerID }
          : paper.providerIDs,
      urls: [
        ...new Set([
          ...reconstructed.map((entry) => entry.url),
          ...boundProviderURLs,
        ]),
      ],
      publicationEvidence: isNovelty
        ? paper.publicationClass === "under_review_or_submission"
          ? [...reconstructed, ...providerEvidence]
          : boundProviderURLs.length
            ? providerEvidence.filter((entry) =>
                boundProviderURLs.includes(entry.url),
              )
            : []
        : reconstructed.length
          ? reconstructed
          : [],
    };
  });

  const verifiedPayload = {
    ...params.discovery,
    liveVerification: {
      verifierVersion: 2,
      verifiedAt: new Date().toISOString(),
    },
    verifiedMain: papersWithLiveEvidence,
    otherPeerReviewed: [],
    noveltyRadar: [],
    limitations: [
      ...new Set([
        ...params.discovery.limitations,
        ...(params.limitations || []),
        ...(failures.length
          ? [
              "Publication status could not be verified for one or more official sources during live recheck.",
              ...failures.slice(0, 8),
            ]
          : []),
      ]),
    ],
  };
  return parseDiscoveryResult(JSON.stringify(verifiedPayload), {
    allowReviewLinks: true,
    allowLiveVerificationMarker: true,
  });
}
