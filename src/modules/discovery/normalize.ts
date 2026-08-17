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
  const normalized = normalizeWhitespace(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();
  return /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(normalized)
    ? normalized
    : undefined;
}

const SECRET_PARAMETER_SUBSTRINGS = [
  "token",
  "secret",
  "signature",
  "credential",
  "password",
  "passwd",
  "apikey",
  "api_key",
  "sessionid",
];
const SECRET_PARAMETER_WORDS = new Set([
  "auth",
  "authorization",
  "bearer",
  "code",
  "jwt",
  "key",
  "sess",
  "session",
  "sig",
]);

// Prefixed credential names such as X-Amz-Signature must match, so secret
// vocabulary is checked per separator-delimited word and, for the strong
// terms, as substrings of the whole name.
export function isSecretQueryParameterName(key: string) {
  const lower = key.toLowerCase();
  if (SECRET_PARAMETER_SUBSTRINGS.some((term) => lower.includes(term))) {
    return true;
  }
  return lower.split(/[-_.]/).some((word) => SECRET_PARAMETER_WORDS.has(word));
}

// Spelled edition ordinals are open-ended ("The Sixtieth ...", "Sixty-First",
// "The One Hundredth ..."), so detection is pattern-based and sequence-aware:
// a run of spelled number words is an edition marker only when it ends in an
// ordinal form. A lone cardinal ("One" in "One Health") is a meaningful name
// word and stays distinctive.
const SPELLED_ORDINAL_TERMINATORS = [
  /^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)$/,
  /^(?:thir|four|fif|six|seven|eigh|nine)teenth$/,
  /^(?:twen|thir|for|fif|six|seven|eigh|nine)tieth$/,
  /^(?:hundred|thousand)th$/,
];
const SPELLED_CARDINAL_PARTS = [
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/,
  /^(?:thir|four|fif|six|seven|eigh|nine)teen$/,
  /^(?:twen|thir|for|fif|six|seven|eigh|nine)ty$/,
  /^(?:hundred|thousand)$/,
];

function isSpelledOrdinalTerminator(word: string) {
  return SPELLED_ORDINAL_TERMINATORS.some((pattern) => pattern.test(word));
}

function isSpelledCardinalPart(word: string) {
  return SPELLED_CARDINAL_PARTS.some((pattern) => pattern.test(word));
}

// Removes spelled number runs that END in an ordinal form ("one hundredth",
// "one hundred and first", "sixty first", "twelfth") while keeping number
// words that are part of the venue's actual name: a lone cardinal ("One
// Health") and cardinals AFTER a terminator ("First One Health") both stay.
export function stripSpelledOrdinalSequences(words: string[]): string[] {
  const kept: string[] = [];
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (isSpelledCardinalPart(word) || isSpelledOrdinalTerminator(word)) {
      // Scan one candidate run: cardinals joined by optional "and"
      // connectors, ending at the first ordinal terminator.
      let cursor = index;
      let terminatorEnd = -1;
      while (cursor < words.length) {
        const current = words[cursor];
        if (isSpelledOrdinalTerminator(current)) {
          terminatorEnd = cursor + 1;
          break;
        }
        if (isSpelledCardinalPart(current)) {
          cursor += 1;
          continue;
        }
        if (
          current === "and" &&
          cursor > index &&
          cursor + 1 < words.length &&
          (isSpelledCardinalPart(words[cursor + 1]) ||
            isSpelledOrdinalTerminator(words[cursor + 1]))
        ) {
          cursor += 1;
          continue;
        }
        break;
      }
      if (terminatorEnd >= 0) {
        index = terminatorEnd;
        continue;
      }
      kept.push(word);
      index += 1;
      continue;
    }
    kept.push(word);
    index += 1;
  }
  return kept;
}

export function normalizeHttpURL(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (url.username || url.password) return undefined;
    if ([...url.searchParams.keys()].some(isSecretQueryParameterName)) {
      return undefined;
    }
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

export function canonicalDiscoveryPaperID(
  paper: Pick<DiscoveredPaper, "title" | "authors" | "year" | "doi">,
  disambiguator = "",
) {
  const doi = paper.doi ? normalizeDiscoveryDOI(paper.doi) : undefined;
  if (doi) return `doi:${doi}`;
  const author = paper.authors
    .map(authorKey)
    .filter(Boolean)
    .slice(0, 2)
    .join("+");
  const base = `paper:${normalizeDiscoveryTitle(paper.title)}:${paper.year || "unknown"}:${author || "unknown"}`;
  return disambiguator
    ? `${base}:${normalizeDiscoveryTitle(disambiguator) || "distinct"}`
    : base;
}

export function isPublicReviewURL(value?: string, reviewURL?: string) {
  if (!value) return false;
  const normalized = normalizeHttpURL(value);
  if (!normalized) return false;
  const expected = reviewURL ? normalizeHttpURL(reviewURL) : undefined;
  if (expected && normalized === expected) return true;
  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostname === "openreview.net" || hostname.endsWith(".openreview.net");
}

function authorKey(author: string) {
  return normalizeDiscoveryTitle(author).split(" ").pop() || "";
}

function hasAuthorOverlap(left: string[], right: string[]) {
  const leftAuthors = new Set(left.map(authorKey).filter(Boolean));
  return right.some((author) => leftAuthors.has(authorKey(author)));
}

function hasSharedProviderID(
  left: Pick<DiscoveredPaper, "providerIDs">,
  right: Pick<DiscoveredPaper, "providerIDs">,
) {
  return Object.entries(left.providerIDs).some(
    ([provider, id]) => Boolean(id) && right.providerIDs[provider] === id,
  );
}

function normalizeVersionTitle(value: string) {
  return normalizeDiscoveryTitle(value).replace(
    /(?: preprint| extended version| conference version| journal version)$/u,
    "",
  );
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
  options: { trustProviderIDs?: boolean } = {},
) {
  const titleMatches =
    normalizeVersionTitle(left.title) === normalizeVersionTitle(right.title);
  const yearsConflict =
    Boolean(left.year && right.year) && Math.abs(left.year! - right.year!) > 1;
  const authorsConflict =
    left.authors.length > 0 &&
    right.authors.length > 0 &&
    !hasAuthorOverlap(left.authors, right.authors);
  const materiallyConflicts = !titleMatches || yearsConflict || authorsConflict;
  const leftDOI = left.doi ? normalizeDiscoveryDOI(left.doi) : undefined;
  const rightDOI = right.doi ? normalizeDiscoveryDOI(right.doi) : undefined;
  if (leftDOI && rightDOI) {
    return leftDOI === rightDOI && !materiallyConflicts;
  }

  if (options.trustProviderIDs && hasSharedProviderID(left, right)) {
    return !materiallyConflicts;
  }

  if (!titleMatches) return false;

  if (!left.year || !right.year) return false;
  if (left.year === right.year) {
    return (
      !left.authors.length ||
      !right.authors.length ||
      hasAuthorOverlap(left.authors, right.authors)
    );
  }
  return (
    Math.abs(left.year - right.year) <= 1 &&
    left.authors.length > 0 &&
    right.authors.length > 0 &&
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
        { trustProviderIDs: true },
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
