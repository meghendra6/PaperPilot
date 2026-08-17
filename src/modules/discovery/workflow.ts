import { parseDiscoveryResult } from "./parser";
import {
  areLikelySamePaper,
  normalizeDiscoveryTitle,
  isSpelledOrdinalWord,
} from "./normalize";
import {
  classifyOfficialEvidenceURL,
  fetchOpenReviewForumNotes,
  inspectOfficialEvidenceURL,
} from "./providers/officialEvidence";
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

export interface OpenReviewOfficialStatus {
  decision?: { label: string; accepted: boolean };
  track?: { label: string; main: boolean };
  reviewsAvailable: boolean;
  officialVenueText: string;
  officialVenueFieldText: string;
  submissionTitle?: string;
  submissionAuthors: string[];
}

function openReviewForumID(url: string) {
  try {
    if (classifyOfficialEvidenceURL(url)?.id !== "openreview") {
      return undefined;
    }
    const parsed = new URL(url);
    if (parsed.pathname !== "/forum") return undefined;
    return parsed.searchParams.get("id") || undefined;
  } catch {
    return undefined;
  }
}

const GENERIC_VENUE_WORDS = new Set([
  "annual",
  "association",
  "bulletin",
  "colloquium",
  "conference",
  "congress",
  "forum",
  "international",
  "journal",
  "letters",
  "magazine",
  "meeting",
  "proceedings",
  "review",
  "reviews",
  "seminar",
  "society",
  "summit",
  "symposium",
  "transactions",
  "workshop",
]);

const VENUE_CONTEXT_WORDS = new Set([
  "a",
  "an",
  "and",
  "accept",
  "accepted",
  "acceptance",
  "at",
  "camera",
  "decision",
  "for",
  "in",
  "main",
  "notable",
  "of",
  "on",
  "oral",
  "poster",
  "ready",
  "reject",
  "rejected",
  "spotlight",
  "submitted",
  "the",
  "to",
  "track",
  "withdrawn",
]);

// Words that name the kind of venue. A disagreement here (conference vs
// symposium) always means a different venue, regardless of shared modifiers
// such as "international".
const VENUE_TYPE_WORDS = new Set([
  "bulletin",
  "colloquium",
  "conference",
  "congress",
  "forum",
  "journal",
  "letters",
  "magazine",
  "meeting",
  "seminar",
  "summit",
  "symposium",
  "transactions",
  "workshop",
]);

const VENUE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
]);

function normalizedVenueWords(text: string) {
  return normalizeDiscoveryTitle(
    // Only acronym-shaped parentheticals (single token, two or more capital
    // letters) become acronym keys instead of name words. Descriptive
    // parentheticals such as "(Security)" stay distinctive name words so
    // they can still conflict with a different official parenthetical.
    text.replace(/\(([^)]*)\)/g, (fullMatch, inner: string) => {
      const trimmed = inner.trim();
      return /^[A-Za-z0-9]{2,12}$/.test(trimmed) &&
        trimmed.replace(/[^A-Z]/g, "").length >= 2
        ? " "
        : ` ${trimmed} `;
    }),
  )
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, " ")
    .split(" ")
    .filter(Boolean);
}

function significantVenueWords(text: string) {
  return normalizedVenueWords(text).filter(
    (word) =>
      word.length >= 3 &&
      !/^\d+$/.test(word) &&
      !isSpelledOrdinalWord(word) &&
      !GENERIC_VENUE_WORDS.has(word) &&
      !VENUE_CONTEXT_WORDS.has(word),
  );
}

function venueTypeWords(text: string) {
  return new Set(
    normalizedVenueWords(text).filter((word) => VENUE_TYPE_WORDS.has(word)),
  );
}

function venueNameInitials(value: string) {
  return normalizedVenueWords(value)
    .filter((word) => !VENUE_STOPWORDS.has(word) && !isSpelledOrdinalWord(word))
    .map((word) => word[0])
    .join("");
}

// Acronym-style keys a claimed venue may legitimately present: an explicit
// acronym, a parenthetical acronym, a distinctive single-word name, the
// compact join of a multi-word name, and initials derived over the full name
// including the venue-type word (so "International Conference on Learning
// Representations" yields "iclr").
function claimAcronymKeys(venue: {
  venueName?: string;
  venueAcronym?: string;
}) {
  const keys = new Set<string>();
  for (const value of [venue.venueName, venue.venueAcronym]) {
    if (!value) continue;
    for (const parenthetical of value.matchAll(/\(([A-Za-z0-9]{2,12})\)/g)) {
      if (parenthetical[1].length >= 3) {
        keys.add(parenthetical[1].toLowerCase());
      }
    }
    const words = normalizedVenueWords(value);
    if (words.length === 1 && significantVenueWords(value).length === 1) {
      keys.add(words[0]);
    }
    if (words.length >= 2) {
      const meaningful = words.filter(
        (word) => !VENUE_STOPWORDS.has(word) && !isSpelledOrdinalWord(word),
      );
      const compact = meaningful.join("");
      if (compact.length >= 6) keys.add(compact);
      const initials = meaningful.map((word) => word[0]).join("");
      if (initials.length >= 3) keys.add(initials);
    }
  }
  return keys;
}

// Venue agreement is meaning-level, not substring-level. The official
// submission venue field is the human-readable name; venueid and invitation
// ids are registrar-controlled tokens. A claim binds when (1) its venue-type
// word does not contradict the official field, (2) the distinctive words of
// both names cover each other, or (3) an acronym-style claim key equals a
// registrar-controlled official token — but two distinctive multi-word names
// that fail mutual coverage are different venues and can never be bridged by
// shared initials.
function officialVenueAgreement(
  paper: DiscoveryResult["verifiedMain"][number],
  status: OpenReviewOfficialStatus,
): { kind: "name" | "acronym"; label: string } | undefined {
  const fieldWords = new Set(
    normalizedVenueWords(status.officialVenueFieldText),
  );
  const officialSignificant = significantVenueWords(
    status.officialVenueFieldText,
  );
  const officialTypes = venueTypeWords(status.officialVenueFieldText);
  const officialTokens = new Set(
    normalizedVenueWords(status.officialVenueText).filter(
      (word) =>
        word.length >= 3 &&
        !/^\d+$/.test(word) &&
        !GENERIC_VENUE_WORDS.has(word) &&
        !VENUE_CONTEXT_WORDS.has(word),
    ),
  );
  const valueAgrees = (value: string) => {
    const words = new Set(normalizedVenueWords(value));
    const significant = [...new Set(significantVenueWords(value))];
    return (
      significant.length > 0 &&
      officialSignificant.length > 0 &&
      officialSignificant.every((word) => words.has(word)) &&
      significant.every((word) => fieldWords.has(word))
    );
  };
  // An unverifiable multi-word claimed name poisons the whole claim when the
  // official field spells out a different distinctive name, or when the
  // claimed name's own initials do not correspond to any registrar-controlled
  // token — an acronym can never rescue such a name.
  const valueContradicts = (value: string) => {
    if ([...new Set(significantVenueWords(value))].length < 2) return false;
    if (valueAgrees(value)) return false;
    if (officialSignificant.length >= 2) return true;
    const initials = venueNameInitials(value);
    return initials.length < 3 || !officialTokens.has(initials);
  };
  const sources = [
    { venueName: paper.venueName, venueAcronym: paper.venueAcronym },
    {
      venueName: paper.leadingVenueAssessment.venueName,
      venueAcronym: paper.leadingVenueAssessment.venueAcronym,
    },
  ].filter((venue) => venue.venueName || venue.venueAcronym);
  // One contradicted source poisons the whole claim: a correct assessment
  // must not rescue conflicting paper metadata, and vice versa.
  for (const venue of sources) {
    const claimTypes = venueTypeWords(venue.venueName || "");
    if (
      claimTypes.size &&
      officialTypes.size &&
      [...claimTypes].every((word) => !officialTypes.has(word))
    ) {
      return undefined;
    }
    const values = [venue.venueName, venue.venueAcronym].filter(
      (value): value is string => Boolean(value),
    );
    if (values.some(valueContradicts)) return undefined;
  }
  for (const venue of sources) {
    const agreedValue = [venue.venueName, venue.venueAcronym]
      .filter((value): value is string => Boolean(value))
      .find(valueAgrees);
    if (agreedValue) return { kind: "name", label: agreedValue };
  }
  for (const venue of sources) {
    const matched = [...claimAcronymKeys(venue)].find((key) =>
      officialTokens.has(key),
    );
    if (matched) {
      // Acronym-only agreement records the registrar token that actually
      // matched, never an unverified full-name expansion.
      const rawAcronym = [
        venue.venueAcronym,
        paper.venueAcronym,
        paper.leadingVenueAssessment.venueAcronym,
      ].find(
        (value) =>
          value && normalizeDiscoveryTitle(value).replace(/ /g, "") === matched,
      );
      return { kind: "acronym", label: rawAcronym || matched.toUpperCase() };
    }
  }
  return undefined;
}

function noteInvitations(note: unknown): string[] {
  if (!note || typeof note !== "object") return [];
  const record = note as Record<string, unknown>;
  return [
    ...(typeof record.invitation === "string" ? [record.invitation] : []),
    ...(Array.isArray(record.invitations)
      ? record.invitations.filter(
          (value): value is string => typeof value === "string",
        )
      : []),
  ];
}

function noteContentList(note: unknown, key: string): string[] {
  if (!note || typeof note !== "object") return [];
  const content = (note as Record<string, unknown>).content;
  if (!content || typeof content !== "object") return [];
  let raw = (content as Record<string, unknown>)[key];
  if (raw && typeof raw === "object" && "value" in raw) {
    raw = (raw as Record<string, unknown>).value;
  }
  if (typeof raw === "string") return [raw];
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

function noteContentValue(note: unknown, key: string) {
  if (!note || typeof note !== "object") return undefined;
  const content = (note as Record<string, unknown>).content;
  if (!content || typeof content !== "object") return undefined;
  const raw = (content as Record<string, unknown>)[key];
  if (typeof raw === "string") return raw;
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).value === "string"
  ) {
    return (raw as Record<string, unknown>).value as string;
  }
  return undefined;
}

// Forum text is writable by any OpenReview user, so decision and track are
// derived only from API notes whose invitation names OpenReview itself
// controls, never from prose on the rendered page.
export function deriveOpenReviewOfficialStatus(
  notes: unknown[],
  forumID: string,
): OpenReviewOfficialStatus {
  const forumNotes = notes.filter((note) => {
    if (!note || typeof note !== "object") return false;
    const record = note as Record<string, unknown>;
    return record.forum === forumID || record.id === forumID;
  });
  const decisionNote = forumNotes.find((note) =>
    noteInvitations(note).some((invitation) =>
      /\/-\/decision$/i.test(invitation),
    ),
  );
  const decisionText = [
    noteContentValue(decisionNote, "decision"),
    noteContentValue(decisionNote, "recommendation"),
  ]
    .filter(Boolean)
    .join(" ");
  const submission = forumNotes.find(
    (note) => (note as Record<string, unknown>).id === forumID,
  );
  // The venue field is the human-readable name and drives name agreement;
  // venueid is a registrar-controlled identifier and belongs to the token
  // surface alongside invitation ids.
  const venueFieldText = noteContentValue(submission, "venue") || "";
  const venueIDText = noteContentValue(submission, "venueid") || "";
  const venueText = [venueFieldText, venueIDText].filter(Boolean).join(" ");
  const rejected =
    /reject|withdraw/i.test(decisionText) || /withdraw/i.test(venueText);
  const accepted = !rejected && /accept/i.test(decisionText);
  const trackSurface = `${decisionText} ${venueText}`;
  const nonMain = NON_MAIN_TRACKS.find(([pattern]) =>
    pattern.test(trackSurface),
  );
  const trackLabel = trackSurface.match(
    /\b(oral|poster|spotlight|main(?: conference| track)?)\b/i,
  )?.[1];
  return {
    decision: rejected
      ? { label: "Rejected or withdrawn", accepted: false }
      : accepted
        ? { label: "Accepted", accepted: true }
        : undefined,
    // A bare acceptance without an explicit main-program marker stays
    // track-unknown; only an official oral/poster/spotlight/main label may
    // claim the main track.
    track: nonMain
      ? { label: nonMain[1], main: false }
      : accepted && trackLabel
        ? { label: trackLabel, main: true }
        : undefined,
    reviewsAvailable: forumNotes.some((note) =>
      noteInvitations(note).some((invitation) =>
        /\/-\/official_review$/i.test(invitation),
      ),
    ),
    submissionTitle: noteContentValue(submission, "title"),
    submissionAuthors: noteContentList(submission, "authors"),
    // Legacy API v1 submissions often carry the venue only in the invitation
    // id (for example "ICLR.cc/2017/conference/-/submission"), so venueid and
    // invitations join the official token surface.
    officialVenueText: [
      venueFieldText,
      venueIDText,
      decisionText,
      ...noteInvitations(submission),
      ...noteInvitations(decisionNote),
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),
    officialVenueFieldText: venueFieldText,
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
    // A claimed DOI binds identity only when the official page itself shows
    // that DOI. Without on-page DOI corroboration, author evidence is
    // required, so an authorless row cannot ride a copied DOI through the
    // title/year path.
    if (!authorKeys.length) continue;
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

// Identity fields recovered from the OpenReview registrar API when the human
// page is challenge-gated. They are checked field-by-field: a flattened text
// surface would let venue words satisfy the author match or let title/URL
// digits satisfy the edition-year match.
export interface RegistrarIdentityRecord {
  title: string;
  authors: string[];
  editionSurface: string;
}

export type EvidenceInspection = Awaited<
  ReturnType<typeof inspectOfficialEvidenceURL>
> & {
  registrarIdentity?: RegistrarIdentityRecord;
};

function registrarIdentityConfirms(
  paper: DiscoveryResult["verifiedMain"][number],
  registrar: RegistrarIdentityRecord,
) {
  if (!pageMatchesPaperTitle(registrar.title, paper.title)) return false;
  const claimedKeys = authorIdentityKeys(paper.authors);
  // Each claimed author key consumes one registrar author entry, so a
  // duplicated claimed surname cannot count twice against a single registrar
  // author while two genuine same-surname authors still match.
  const registrarKeyCounts = new Map<string, number>();
  for (const key of authorIdentityKeys(registrar.authors)) {
    registrarKeyCounts.set(key, (registrarKeyCounts.get(key) || 0) + 1);
  }
  const requiredMatches = Math.min(2, claimedKeys.length);
  if (!claimedKeys.length || !registrarKeyCounts.size) return false;
  let observedMatches = 0;
  for (const key of claimedKeys) {
    const remaining = registrarKeyCounts.get(key) || 0;
    if (remaining > 0) {
      registrarKeyCounts.set(key, remaining - 1);
      observedMatches += 1;
    }
  }
  if (observedMatches < requiredMatches) return false;
  if (!paper.year) return false;
  return new RegExp(`\\b${paper.year}\\b`).test(
    normalizeDiscoveryTitle(registrar.editionSurface),
  );
}

export function reconstructOfficialEvidence(
  paper: DiscoveryResult["verifiedMain"][number],
  inspection: EvidenceInspection,
  options: {
    authorityValidated?: boolean;
    openReviewStatus?: OpenReviewOfficialStatus;
  } = {},
): PublicationEvidence | undefined {
  if (!inspection.bodyInspected) return undefined;
  const page = [inspection.pageTitle, inspection.searchableText]
    .filter(Boolean)
    .join(" ");
  let identity: ReturnType<typeof paperIdentityContext>;
  if (inspection.registrarIdentity) {
    if (!registrarIdentityConfirms(paper, inspection.registrarIdentity)) {
      return undefined;
    }
  } else {
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
    identity = paperIdentityContext(
      `${page} ${inspection.url}`,
      paper,
      `${inspection.pageTitle || ""} ${inspection.url}`,
    );
    if (!identity) return undefined;
  }
  const statusClaims =
    inspection.sourceFamily === "openreview"
      ? options.openReviewStatus &&
        Boolean(
          options.openReviewStatus.decision || options.openReviewStatus.track,
        )
        ? options.openReviewStatus
        : undefined
      : undefined;
  // A venue-bearing claim must be corroborated on the inspected paper page.
  // When an official OpenReview decision or track is in play, only the
  // official API venue surface may corroborate it: forum prose is writable by
  // any user and cannot vouch for the venue behind an acceptance. When only
  // the acronym could be verified, the evidence records the verified acronym
  // rather than endorsing an unverified full-name expansion.
  const venue = statusClaims
    ? officialVenueAgreement(paper, statusClaims)?.label
    : observedVenue(paper, page);
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
  // identity is only absent on the registrar path, which is openreview-only,
  // so the non-openreview branches below always see a resolved context.
  const context = identity?.context ?? "";
  const openReviewStatus =
    inspection.sourceFamily === "openreview"
      ? options.openReviewStatus
      : undefined;
  const resolvedTrack =
    inspection.sourceFamily === "openreview"
      ? openReviewStatus?.track
      : inferEntryBoundTrack({
          page,
          entryContext: context,
          titleIndex: identity?.index ?? 0,
          title: paper.title,
          url: inspection.url,
          type,
          sourceFamily: inspection.sourceFamily,
        });
  const decision =
    inspection.sourceFamily === "openreview"
      ? openReviewStatus?.decision
      : inferDecision(context);
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
    openReviewStatus?.reviewsAvailable
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
  const evidenceInspections = new Map<string, EvidenceInspection>();
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

  const openReviewStatuses = new Map<string, OpenReviewOfficialStatus>();
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
      continue;
    }
    // The status forum id must come from the inspected final URL so a
    // redirecting claimed URL cannot pair another forum's page with its own
    // decision record.
    const inspection = evidenceInspections.get(url)!;
    let forumID = openReviewForumID(inspection.url);
    let identityFromRegistrar = false;
    if (
      !forumID &&
      classifyOfficialEvidenceURL(inspection.url)?.id === "openreview"
    ) {
      // OpenReview gates anonymous page loads behind a challenge/login
      // interstitial that carries no forum id. The fixed-host notes API is
      // still the registrar authority for the claimed forum id, and identity
      // must then come from the registrar submission record instead of the
      // interstitial page: a claim naming someone else's forum still fails
      // the title/author match below.
      forumID = openReviewForumID(url);
      identityFromRegistrar = Boolean(forumID);
    }
    if (!forumID) continue;
    try {
      const status = deriveOpenReviewOfficialStatus(
        await fetchOpenReviewForumNotes({
          forumID,
          fetch: params.fetch,
          signal: params.signal,
          deadline,
        }),
        forumID,
      );
      openReviewStatuses.set(url, status);
      if (identityFromRegistrar && status.submissionTitle) {
        // Identity is validated field-by-field against this record instead of
        // a flattened text surface: authors must match the registrar author
        // list and the claimed year must appear in the registrar
        // venue/venueid/invitation edition surface.
        evidenceInspections.set(url, {
          ...inspection,
          url: `https://openreview.net/forum?id=${forumID}`,
          pageTitle: status.submissionTitle,
          searchableText: [
            status.submissionTitle,
            status.submissionAuthors.join(", "),
            status.officialVenueText,
          ]
            .filter(Boolean)
            .join(" — "),
          registrarIdentity: {
            title: status.submissionTitle,
            authors: status.submissionAuthors,
            editionSurface: status.officialVenueText,
          },
        });
      }
    } catch (error) {
      if (params.signal?.aborted) throw error;
      failures.push(
        `${url}: official OpenReview status was unavailable (${
          error instanceof Error ? error.message : "unavailable"
        }).`,
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
              openReviewStatus: openReviewStatuses.get(entry.url),
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
