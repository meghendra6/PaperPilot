import type { DiscoveredPaper, DiscoveryProviderCandidate } from "./types";

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeDiscoveryTitle(value: string) {
  return normalizeWhitespace(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeDiscoveryDOI(value: string) {
  return normalizeWhitespace(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

export function normalizeHttpURL(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function authorKey(author: string) {
  return normalizeDiscoveryTitle(author).split(" ").pop() || "";
}

function hasAuthorOverlap(left: string[], right: string[]) {
  const leftAuthors = new Set(left.map(authorKey).filter(Boolean));
  return right.some((author) => leftAuthors.has(authorKey(author)));
}

export function areLikelySamePaper(
  left: Pick<
    DiscoveredPaper,
    "title" | "authors" | "year" | "doi" | "providerIDs"
  >,
  right: Pick<
    DiscoveredPaper,
    "title" | "authors" | "year" | "doi" | "providerIDs"
  >,
) {
  if (left.doi && right.doi) {
    return normalizeDiscoveryDOI(left.doi) === normalizeDiscoveryDOI(right.doi);
  }

  const leftIDs = Object.entries(left.providerIDs);
  if (
    leftIDs.some(([provider, id]) => id && right.providerIDs[provider] === id)
  ) {
    return true;
  }

  if (
    normalizeDiscoveryTitle(left.title) !== normalizeDiscoveryTitle(right.title)
  ) {
    return false;
  }

  if (left.year && right.year && Math.abs(left.year - right.year) > 1) {
    return false;
  }

  return (
    !left.authors.length ||
    !right.authors.length ||
    hasAuthorOverlap(left.authors, right.authors)
  );
}

export function deduplicateDiscoveredPapers(papers: DiscoveredPaper[]) {
  const unique: DiscoveredPaper[] = [];
  const duplicateTitles: string[] = [];

  const publicationRank: Record<DiscoveredPaper["publicationClass"], number> = {
    verified_main: 0,
    verified_journal: 1,
    published_track_unknown: 2,
    verified_workshop: 3,
    verified_findings: 3,
    verified_demo: 3,
    verified_industry: 3,
    verified_shared_task: 3,
    verified_tutorial_or_abstract: 3,
    preprint_only: 4,
    under_review_or_submission: 5,
    unverified: 6,
    rejected_or_withdrawn: 7,
  };
  const confidenceRank = { high: 0, medium: 1, low: 2, none: 3 };
  const relationshipRank = { direct: 0, strong: 1, adjacent: 2 };

  const merge = (left: DiscoveredPaper, right: DiscoveredPaper) => {
    const leftPreferred =
      publicationRank[left.publicationClass] <
        publicationRank[right.publicationClass] ||
      (publicationRank[left.publicationClass] ===
        publicationRank[right.publicationClass] &&
        confidenceRank[left.evidenceConfidence] <=
          confidenceRank[right.evidenceConfidence]);
    const preferred = leftPreferred ? left : right;
    const alternate = leftPreferred ? right : left;
    const evidence = [...preferred.publicationEvidence];
    for (const entry of alternate.publicationEvidence) {
      if (
        !evidence.some(
          (existing) =>
            existing.type === entry.type && existing.url === entry.url,
        )
      ) {
        evidence.push(entry);
      }
    }
    return {
      ...preferred,
      authors:
        preferred.authors.length >= alternate.authors.length
          ? preferred.authors
          : alternate.authors,
      year: preferred.year || alternate.year,
      abstract: preferred.abstract || alternate.abstract,
      doi: preferred.doi || alternate.doi,
      urls: [...new Set([...preferred.urls, ...alternate.urls])],
      providerIDs: {
        ...alternate.providerIDs,
        ...preferred.providerIDs,
      },
      venueName: preferred.venueName || alternate.venueName,
      venueAcronym: preferred.venueAcronym || alternate.venueAcronym,
      track: preferred.track || alternate.track,
      publicationEvidence: evidence,
      relationship:
        relationshipRank[preferred.relationship] <=
        relationshipRank[alternate.relationship]
          ? preferred.relationship
          : alternate.relationship,
      keyDifference: preferred.keyDifference || alternate.keyDifference,
      reviewURL: preferred.reviewURL || alternate.reviewURL,
      reviewInsight: preferred.reviewInsight || alternate.reviewInsight,
      existingItemID: preferred.existingItemID || alternate.existingItemID,
    } satisfies DiscoveredPaper;
  };

  for (const paper of papers) {
    const existingIndex = unique.findIndex((candidate) =>
      areLikelySamePaper(candidate, paper),
    );
    if (existingIndex >= 0) {
      duplicateTitles.push(paper.title);
      unique[existingIndex] = merge(unique[existingIndex], paper);
      continue;
    }
    unique.push(paper);
  }

  return { papers: unique, duplicateTitles };
}

export function deduplicateProviderCandidates(
  candidates: DiscoveryProviderCandidate[],
) {
  const unique: DiscoveryProviderCandidate[] = [];
  for (const candidate of candidates) {
    const candidateShape = {
      ...candidate,
      providerIDs: { [candidate.provider]: candidate.providerID },
    };
    const existingIndex = unique.findIndex((entry) =>
      areLikelySamePaper(
        {
          ...entry,
          providerIDs: { [entry.provider]: entry.providerID },
        },
        candidateShape,
      ),
    );
    if (existingIndex >= 0) {
      const existing = unique[existingIndex];
      unique[existingIndex] = {
        ...existing,
        authors:
          existing.authors.length >= candidate.authors.length
            ? existing.authors
            : candidate.authors,
        year: existing.year || candidate.year,
        abstract: existing.abstract || candidate.abstract,
        doi: existing.doi || candidate.doi,
        venueName: existing.venueName || candidate.venueName,
        urls: [...new Set([...existing.urls, ...candidate.urls])],
      };
      continue;
    }
    unique.push(candidate);
  }
  return unique;
}
