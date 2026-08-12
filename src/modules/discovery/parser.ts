import {
  deduplicateDiscoveredPapers,
  normalizeDiscoveryDOI,
  normalizeDiscoveryTitle,
  normalizeHttpURL,
  normalizeWhitespace,
} from "./normalize";
import type {
  AgentSearchPlan,
  DiscoveredPaper,
  DiscoveryQuery,
  DiscoveryResult,
  EvidenceConfidence,
  ExcludedDiscoveryCandidate,
  LeadingVenueAssessment,
  LeadingVenueJudgment,
  NoveltyRelationship,
  PublicationClass,
  PublicationEvidence,
  PublicationEvidenceSupport,
  PublicationEvidenceType,
  PublicReviewInsight,
  RelationshipStrength,
} from "./types";

const PUBLICATION_CLASSES = new Set<PublicationClass>([
  "verified_main",
  "verified_workshop",
  "verified_findings",
  "verified_demo",
  "verified_industry",
  "verified_shared_task",
  "verified_tutorial_or_abstract",
  "verified_journal",
  "published_track_unknown",
  "preprint_only",
  "under_review_or_submission",
  "rejected_or_withdrawn",
  "unverified",
]);
const EVIDENCE_TYPES = new Set<PublicationEvidenceType>([
  "official_proceedings",
  "official_program",
  "official_decision",
  "publisher_proceedings",
  "official_anthology",
  "scholarly_index",
  "author_claim",
  "search_result",
]);
const EVIDENCE_SUPPORTS = new Set<PublicationEvidenceSupport>([
  "identity",
  "published",
  "accepted",
  "main_track",
  "reviews_available",
]);
const LEADING_JUDGMENTS = new Set<LeadingVenueJudgment>([
  "leading",
  "plausibly_leading",
  "not_leading",
  "unknown",
]);
const RELATIONSHIPS = new Set<RelationshipStrength>([
  "direct",
  "strong",
  "adjacent",
]);
const NOVELTY_RELATIONSHIPS = new Set<NoveltyRelationship>([
  "same_problem_same_core_method",
  "same_problem_different_method",
  "same_method_different_setting",
  "extends_or_generalizes",
  "contradicts_or_challenges",
  "background_or_foundational",
  "no_material_collision",
  "unclear",
]);
const DIRECT_OFFICIAL_TYPES = new Set<PublicationEvidenceType>([
  "official_proceedings",
  "official_program",
  "official_decision",
  "publisher_proceedings",
  "official_anthology",
]);
const PEER_REVIEWED_CLASSES = new Set<PublicationClass>([
  "verified_main",
  "verified_workshop",
  "verified_findings",
  "verified_demo",
  "verified_industry",
  "verified_shared_task",
  "verified_tutorial_or_abstract",
  "verified_journal",
  "published_track_unknown",
]);
const NOVELTY_CLASSES = new Set<PublicationClass>([
  "preprint_only",
  "under_review_or_submission",
]);
const MAX_PRIMARY = 12;
const MAX_SECONDARY = 6;
const MAX_QUERIES = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

function optionalText(value: unknown) {
  const normalized = text(value);
  return normalized || undefined;
}

function stringList(value: unknown, max = 12) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean).slice(0, max);
}

function extractJsonCandidates(raw: string) {
  const trimmed = raw.trim();
  const candidates = new Set<string>();
  if (trimmed) candidates.add(trimmed);
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    if (match[1]?.trim()) candidates.add(match[1].trim());
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.add(trimmed.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return [...candidates];
}

function parseVenue(value: unknown): LeadingVenueAssessment | undefined {
  if (!isRecord(value)) return undefined;
  const record = value;
  const venueName = text(record.venueName || record.name);
  const fields = stringList(record.fields, 6);
  const basis = text(record.basis);
  if (!venueName || !fields.length || !basis) return undefined;
  const judgment = LEADING_JUDGMENTS.has(
    record.judgment as LeadingVenueJudgment,
  )
    ? (record.judgment as LeadingVenueJudgment)
    : "unknown";
  const confidence = ["high", "medium", "low"].includes(
    String(record.confidence),
  )
    ? (record.confidence as LeadingVenueAssessment["confidence"])
    : "low";
  return {
    venueName,
    venueAcronym: optionalText(record.venueAcronym || record.acronym),
    fields,
    judgment,
    confidence,
    basis,
  };
}

function parseQuery(value: unknown): DiscoveryQuery | undefined {
  if (!isRecord(value)) return undefined;
  const query = text(value.query);
  const family = text(value.family);
  const rationale = text(value.rationale);
  if (!query || !family || !rationale) return undefined;
  return {
    query,
    family,
    rationale,
    venueTarget: optionalText(value.venueTarget),
    freshness:
      value.freshness === "recent" || value.freshness === "archival"
        ? value.freshness
        : undefined,
  };
}

function parsePlan(value: unknown): AgentSearchPlan {
  if (!isRecord(value)) throw new Error("Discovery plan is required.");
  const record = value;
  const concernSummary = text(record.concernSummary);
  const primaryField = text(record.primaryField);
  const scopeSummary = text(record.scopeSummary);
  const venues = Array.isArray(record.venues)
    ? record.venues
        .map(parseVenue)
        .filter((venue): venue is LeadingVenueAssessment => Boolean(venue))
        .slice(0, 16)
    : [];
  const queries = Array.isArray(record.queries)
    ? record.queries
        .map(parseQuery)
        .filter((query): query is DiscoveryQuery => Boolean(query))
        .slice(0, MAX_QUERIES)
    : [];
  const families = new Set(queries.map((query) => query.family.toLowerCase()));
  if (
    !concernSummary ||
    !primaryField ||
    !scopeSummary ||
    !venues.length ||
    queries.length < 3 ||
    families.size < 3
  ) {
    throw new Error(
      "Discovery plan must include the concern, primary field, bounded venue assessments, scope, and at least three distinct query families.",
    );
  }
  return {
    concernSummary,
    primaryField,
    adjacentFields: stringList(record.adjacentFields, 6),
    venues,
    queries,
    scopeSummary,
  };
}

function parseEvidence(value: unknown): PublicationEvidence | undefined {
  if (!isRecord(value) || !EVIDENCE_TYPES.has(value.type as never)) {
    return undefined;
  }
  const sourceName = text(value.sourceName);
  const url =
    typeof value.url === "string" ? normalizeHttpURL(value.url) : undefined;
  if (!sourceName || !url) return undefined;
  const supports = Array.isArray(value.supports)
    ? value.supports.filter((entry): entry is PublicationEvidenceSupport =>
        EVIDENCE_SUPPORTS.has(entry as PublicationEvidenceSupport),
      )
    : [];
  return {
    type: value.type as PublicationEvidenceType,
    sourceName,
    url,
    observedTitle: optionalText(value.observedTitle),
    observedVenue: optionalText(value.observedVenue),
    observedTrack: optionalText(value.observedTrack),
    observedDecision: optionalText(value.observedDecision),
    checkedAt: text(value.checkedAt) || new Date().toISOString(),
    supports,
  };
}

function parseReviewInsight(value: unknown): PublicReviewInsight | undefined {
  if (!isRecord(value)) return undefined;
  const sourceURLs = Array.isArray(value.sourceURLs)
    ? value.sourceURLs
        .map((entry) =>
          typeof entry === "string" ? normalizeHttpURL(entry) : undefined,
        )
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 12)
    : [];
  if (!sourceURLs.length) return undefined;
  return {
    sourceURLs,
    valuedStrengths: stringList(value.valuedStrengths, 8),
    concerns: stringList(value.concerns, 8),
    reviewerPriorities: stringList(value.reviewerPriorities, 8),
    disagreements: stringList(value.disagreements, 8),
    authorResponseContext: optionalText(value.authorResponseContext),
    decisionContext: optionalText(value.decisionContext),
    limitations: stringList(value.limitations, 8),
    generatedAt: text(value.generatedAt) || new Date().toISOString(),
  };
}

function parsePaper(
  value: unknown,
  allowReviewLinks: boolean,
): DiscoveredPaper | undefined {
  if (!isRecord(value)) return undefined;
  const title = text(value.title);
  const relevanceReason = text(value.relevanceReason || value.reason);
  if (!title || !relevanceReason) return undefined;

  const publicationClass = PUBLICATION_CLASSES.has(
    value.publicationClass as PublicationClass,
  )
    ? (value.publicationClass as PublicationClass)
    : "unverified";
  const relationship = RELATIONSHIPS.has(value.relationship as never)
    ? (value.relationship as RelationshipStrength)
    : "adjacent";
  const noveltyRelationship = NOVELTY_RELATIONSHIPS.has(
    value.noveltyRelationship as never,
  )
    ? (value.noveltyRelationship as NoveltyRelationship)
    : "unclear";
  const evidence = [
    ...new Map(
      (Array.isArray(value.publicationEvidence)
        ? value.publicationEvidence
            .map(parseEvidence)
            .filter((entry): entry is PublicationEvidence => Boolean(entry))
        : []
      ).map((entry) => [`${entry.type}:${entry.url}`, entry] as const),
    ).values(),
  ];
  const urls = Array.isArray(value.urls)
    ? value.urls
        .map((entry) =>
          typeof entry === "string" ? normalizeHttpURL(entry) : undefined,
        )
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const claimedReviewURL =
    typeof value.reviewURL === "string"
      ? normalizeHttpURL(value.reviewURL)
      : undefined;
  const reviewURL =
    allowReviewLinks &&
    claimedReviewURL &&
    evidence.some(
      (entry) =>
        DIRECT_OFFICIAL_TYPES.has(entry.type) &&
        entry.url === claimedReviewURL &&
        entry.supports.includes("reviews_available"),
    )
      ? claimedReviewURL
      : undefined;
  const providerIDs = isRecord(value.providerIDs)
    ? Object.fromEntries(
        Object.entries(value.providerIDs)
          .map(([key, entry]) => [text(key), text(entry)] as const)
          .filter(([key, entry]) => key && entry),
      )
    : {};
  const year =
    typeof value.year === "number" && Number.isFinite(value.year)
      ? Math.trunc(value.year)
      : typeof value.year === "string" && /\d{4}/.test(value.year)
        ? Number.parseInt(value.year.match(/\d{4}/)![0], 10)
        : undefined;
  const claimedConfidence = ["high", "medium", "low", "none"].includes(
    String(value.evidenceConfidence),
  )
    ? (value.evidenceConfidence as EvidenceConfidence)
    : "none";
  const leadingVenueAssessment = parseVenue(value.leadingVenueAssessment);
  const doi =
    typeof value.doi === "string"
      ? normalizeDiscoveryDOI(value.doi)
      : undefined;
  if (!leadingVenueAssessment || (!urls.length && !reviewURL && !doi)) {
    return undefined;
  }

  return {
    candidateID:
      text(value.candidateID) ||
      (typeof value.doi === "string"
        ? `doi:${normalizeDiscoveryDOI(value.doi)}`
        : `title:${title.toLowerCase()}`),
    title,
    authors: stringList(value.authors, 32),
    year,
    abstract: optionalText(value.abstract),
    doi,
    urls: [...new Set([...urls, ...(reviewURL ? [reviewURL] : [])])],
    providerIDs,
    venueName: optionalText(value.venueName || value.venue),
    venueAcronym: optionalText(value.venueAcronym),
    track: optionalText(value.track),
    publicationClass,
    publicationEvidence: evidence,
    evidenceConfidence: claimedConfidence,
    leadingVenueAssessment,
    relationship,
    relevanceReason,
    keyDifference: optionalText(value.keyDifference),
    noveltyRelationship,
    reviewURL,
    reviewInsight: reviewURL
      ? parseReviewInsight(value.reviewInsight)
      : undefined,
    existingItemID:
      typeof value.existingItemID === "number"
        ? value.existingItemID
        : undefined,
  };
}

export function hasQualifyingOfficialEvidence(paper: DiscoveredPaper) {
  const weakDomains = [
    "arxiv.org",
    "semanticscholar.org",
    "dblp.org",
    "scholar.google.com",
    "researchgate.net",
    "openalex.org",
    "crossref.org",
  ];
  const directEvidence = paper.publicationEvidence.filter((entry) => {
    if (!DIRECT_OFFICIAL_TYPES.has(entry.type)) return false;
    let hostname = "";
    try {
      hostname = new URL(entry.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return (
      !weakDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      ) &&
      Boolean(entry.observedTitle) &&
      normalizeDiscoveryTitle(entry.observedTitle || "") ===
        normalizeDiscoveryTitle(paper.title)
    );
  });
  const identity = directEvidence.some((entry) =>
    entry.supports.includes("identity"),
  );
  const mainTrack = directEvidence.some(
    (entry) =>
      entry.supports.includes("main_track") &&
      Boolean(entry.observedTrack?.trim()),
  );
  const acceptedOrPublished = directEvidence.some(
    (entry) =>
      (entry.supports.includes("accepted") &&
        Boolean(entry.observedDecision?.trim())) ||
      (entry.supports.includes("published") &&
        (entry.type === "official_proceedings" ||
          entry.type === "publisher_proceedings" ||
          entry.type === "official_anthology" ||
          Boolean(entry.observedDecision?.trim()))),
  );
  return identity && mainTrack && acceptedOrPublished;
}

function hasPublishedIdentityEvidence(paper: DiscoveredPaper) {
  return paper.publicationEvidence.some(
    (entry) =>
      Boolean(entry.observedTitle) &&
      normalizeDiscoveryTitle(entry.observedTitle || "") ===
        normalizeDiscoveryTitle(paper.title) &&
      entry.supports.includes("identity") &&
      (entry.supports.includes("published") ||
        entry.supports.includes("accepted")),
  );
}

function inferredNonMainClass(
  paper: DiscoveredPaper,
): PublicationClass | undefined {
  const track = [
    paper.track,
    ...paper.publicationEvidence.map((entry) => entry.observedTrack),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/findings/.test(track)) return "verified_findings";
  if (/workshop/.test(track)) return "verified_workshop";
  if (/\b(demo|demonstration)\b/.test(track)) return "verified_demo";
  if (/industry/.test(track)) return "verified_industry";
  if (/shared[ -]?task/.test(track)) return "verified_shared_task";
  if (/tutorial|extended abstract|doctoral consortium/.test(track)) {
    return "verified_tutorial_or_abstract";
  }
  return undefined;
}

function hasDisqualifyingDecision(paper: DiscoveredPaper) {
  return paper.publicationEvidence.some((entry) =>
    /reject|withdraw|retract/.test(entry.observedDecision?.toLowerCase() || ""),
  );
}

export function isPrimaryLaneEligible(paper: DiscoveredPaper) {
  const venue = paper.leadingVenueAssessment;
  return (
    paper.publicationClass === "verified_main" &&
    paper.evidenceConfidence === "high" &&
    hasQualifyingOfficialEvidence(paper) &&
    !inferredNonMainClass(paper) &&
    !hasDisqualifyingDecision(paper) &&
    (venue.judgment === "leading" ||
      (venue.judgment === "plausibly_leading" && venue.confidence === "high"))
  );
}

function relationshipRank(value: RelationshipStrength) {
  return value === "direct" ? 0 : value === "strong" ? 1 : 2;
}

function rankPapers(papers: DiscoveredPaper[]) {
  return [...papers].sort((left, right) => {
    const relationship =
      relationshipRank(left.relationship) -
      relationshipRank(right.relationship);
    if (relationship) return relationship;
    const confidence = { high: 0, medium: 1, low: 2, none: 3 };
    const evidence =
      confidence[left.evidenceConfidence] -
      confidence[right.evidenceConfidence];
    if (evidence) return evidence;
    return (
      (right.year || 0) - (left.year || 0) ||
      left.title.localeCompare(right.title)
    );
  });
}

function parseExcluded(value: unknown): ExcludedDiscoveryCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const title = text(value.title);
  const reasons = new Set<ExcludedDiscoveryCandidate["reason"]>([
    "duplicate",
    "identity_mismatch",
    "rejected_or_withdrawn",
    "insufficient_relevance",
    "unsupported_claim",
    "result_limit",
  ]);
  if (!title || !reasons.has(value.reason as never)) return undefined;
  return {
    title,
    reason: value.reason as ExcludedDiscoveryCandidate["reason"],
  };
}

function normalizeResult(
  record: Record<string, unknown>,
  options: { allowReviewLinks?: boolean } = {},
): DiscoveryResult {
  const allRaw = [
    ...(Array.isArray(record.verifiedMain) ? record.verifiedMain : []),
    ...(Array.isArray(record.otherPeerReviewed)
      ? record.otherPeerReviewed
      : []),
    ...(Array.isArray(record.noveltyRadar) ? record.noveltyRadar : []),
  ];
  const parsed = allRaw
    .map((paper) => parsePaper(paper, options.allowReviewLinks === true))
    .filter((paper): paper is DiscoveredPaper => Boolean(paper));
  const deduplicated = deduplicateDiscoveredPapers(parsed);
  const parseWarnings: string[] = stringList(record.parseWarnings, 20);
  if (parsed.length < allRaw.length) {
    parseWarnings.push(
      `${allRaw.length - parsed.length} paper result(s) were omitted because required fields, a safe open target, or a complete venue assessment were missing.`,
    );
  }
  const verifiedMain: DiscoveredPaper[] = [];
  const otherPeerReviewed: DiscoveredPaper[] = [];
  const noveltyRadar: DiscoveredPaper[] = [];
  const excluded: ExcludedDiscoveryCandidate[] = Array.isArray(record.excluded)
    ? record.excluded
        .map(parseExcluded)
        .filter((entry): entry is ExcludedDiscoveryCandidate => Boolean(entry))
    : [];

  for (const title of deduplicated.duplicateTitles) {
    excluded.push({ title, reason: "duplicate" });
  }

  for (const sourcePaper of deduplicated.papers) {
    let paper = sourcePaper;
    const nonMainClass = inferredNonMainClass(paper);
    if (
      paper.publicationClass === "verified_main" &&
      !isPrimaryLaneEligible(paper) &&
      hasPublishedIdentityEvidence(paper) &&
      (Boolean(nonMainClass) || !hasQualifyingOfficialEvidence(paper))
    ) {
      paper = {
        ...paper,
        publicationClass: nonMainClass || "published_track_unknown",
      };
    }
    if (paper.publicationClass === "rejected_or_withdrawn") {
      excluded.push({ title: paper.title, reason: "rejected_or_withdrawn" });
    } else if (hasDisqualifyingDecision(paper)) {
      excluded.push({ title: paper.title, reason: "rejected_or_withdrawn" });
    } else if (isPrimaryLaneEligible(paper)) {
      verifiedMain.push(paper);
    } else if (
      PEER_REVIEWED_CLASSES.has(paper.publicationClass) &&
      hasPublishedIdentityEvidence(paper)
    ) {
      otherPeerReviewed.push(paper);
    } else if (NOVELTY_CLASSES.has(paper.publicationClass)) {
      noveltyRadar.push(paper);
    } else {
      excluded.push({ title: paper.title, reason: "unsupported_claim" });
    }
  }

  const boundedPrimary = rankPapers(verifiedMain).slice(0, MAX_PRIMARY);
  const boundedOther = rankPapers(otherPeerReviewed).slice(0, MAX_SECONDARY);
  const boundedNovelty = rankPapers(noveltyRadar).slice(0, MAX_SECONDARY);
  const includedIDs = new Set(
    [...boundedPrimary, ...boundedOther, ...boundedNovelty].map(
      (paper) => paper.candidateID,
    ),
  );
  for (const paper of [
    ...verifiedMain,
    ...otherPeerReviewed,
    ...noveltyRadar,
  ].filter((paper) => !includedIDs.has(paper.candidateID))) {
    excluded.push({ title: paper.title, reason: "result_limit" });
  }

  if (
    !boundedPrimary.length &&
    !boundedOther.length &&
    !boundedNovelty.length
  ) {
    throw new Error("Discovery result did not include any usable papers.");
  }

  const plan = parsePlan(record.plan);
  const assessedVenues = new Set(
    plan.venues.map((venue) => normalizeDiscoveryTitle(venue.venueName)),
  );
  // The bounded venue plan governs archival peer-reviewed recommendations.
  // Novelty-radar entries can legitimately name a repository or submission
  // state (for example, arXiv) that is not a leading venue candidate.
  for (const paper of [...boundedPrimary, ...boundedOther]) {
    if (
      !assessedVenues.has(
        normalizeDiscoveryTitle(paper.leadingVenueAssessment.venueName),
      )
    ) {
      throw new Error(
        `Discovery paper venue was not included in the bounded plan assessment: ${paper.leadingVenueAssessment.venueName}`,
      );
    }
  }

  return {
    schemaVersion: 1,
    plan,
    verifiedMain: boundedPrimary,
    otherPeerReviewed: boundedOther,
    noveltyRadar: boundedNovelty,
    excluded,
    limitations: stringList(record.limitations, 12),
    parseWarnings,
    completedAt: text(record.completedAt) || new Date().toISOString(),
  };
}

export function parseDiscoveryResult(
  raw: string,
  options: { allowReviewLinks?: boolean } = {},
): DiscoveryResult {
  let lastError: unknown;
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return normalizeResult(parsed, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Invalid discovery JSON: ${lastError instanceof Error ? lastError.message : "no JSON object found"}`,
  );
}

export function migrateDiscoveryResult(value: unknown) {
  if (!isRecord(value)) return undefined;
  try {
    const migrated = normalizeResult(value);
    const stripUnverifiedReview = (paper: DiscoveredPaper) => ({
      ...paper,
      reviewURL: undefined,
      reviewInsight: undefined,
      publicationEvidence: paper.publicationEvidence.map((entry) => ({
        ...entry,
        supports: entry.supports.filter(
          (support) => support !== "reviews_available",
        ),
      })),
    });
    return {
      ...migrated,
      verifiedMain: migrated.verifiedMain.map(stripUnverifiedReview),
      otherPeerReviewed: migrated.otherPeerReviewed.map(stripUnverifiedReview),
      noveltyRadar: migrated.noveltyRadar.map(stripUnverifiedReview),
      parseWarnings: [
        ...migrated.parseWarnings,
        "Saved public-review links require a fresh live verification before use.",
      ],
    };
  } catch {
    return undefined;
  }
}

export function parsePublicReviewInsight(raw: string): PublicReviewInsight {
  let lastError: unknown;
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      const insight = parseReviewInsight(parsed);
      if (insight) return insight;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Invalid public review insight JSON: ${lastError instanceof Error ? lastError.message : "source-linked review insight required"}`,
  );
}
