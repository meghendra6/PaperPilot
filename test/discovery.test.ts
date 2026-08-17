import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseDiscoveryResult,
  parsePublicReviewInsight,
} from "../src/modules/discovery/parser";
import { buildDiscoveryQuestion } from "../src/modules/discovery/prompt";
import { inferDiscoveryIntent } from "../src/modules/discovery/prompt";
import {
  areLikelySamePaper,
  deduplicateDiscoveredPapers,
} from "../src/modules/discovery/normalize";
import {
  reconstructOfficialEvidence,
  verifyDiscoveryEvidenceLive,
} from "../src/modules/discovery/workflow";
import { buildDiscoveryNoteMarkdown } from "../src/modules/note/discoveryNote";
import {
  buildDiscoveryEvidenceExtra,
  discoveryResultToRecommendationGroups,
} from "../src/modules/relatedRecommendations";

function paper(overrides: Record<string, unknown> = {}) {
  const value = {
    candidateID: "paper-1",
    title: "Verified Paper",
    authors: ["A. Author"],
    year: 2026,
    urls: ["https://proceedings.example.org/paper-1"],
    providerIDs: { index: "paper-1" },
    venueName: "Example Conference",
    track: "Main Conference",
    publicationClass: "verified_main",
    publicationEvidence: [
      {
        type: "official_proceedings",
        sourceName: "Official proceedings",
        url: "https://proceedings.example.org/paper-1",
        observedTitle: "Verified Paper",
        observedVenue: "Example Conference",
        observedTrack: "Main Conference",
        checkedAt: "2026-08-12T00:00:00.000Z",
        supports: ["identity", "published", "main_track"],
      },
    ],
    evidenceConfidence: "high",
    leadingVenueAssessment: {
      venueName: "Example Conference",
      fields: ["example field"],
      judgment: "leading",
      confidence: "high",
      basis: "Field-specific archival venue assessment.",
    },
    relationship: "direct",
    relevanceReason: "Studies the same problem and setting.",
    noveltyRelationship: "same_problem_different_method",
    ...overrides,
  };
  return {
    ...value,
    providerIDs: overrides.providerIDs || { index: String(value.candidateID) },
  };
}

function result(papers: unknown[]) {
  const venueMap = new Map<string, unknown>();
  for (const raw of papers) {
    if (!raw || typeof raw !== "object") continue;
    const assessment = (raw as Record<string, unknown>).leadingVenueAssessment;
    if (!assessment || typeof assessment !== "object") continue;
    const name = String(
      (assessment as Record<string, unknown>).venueName || "",
    );
    if (name) venueMap.set(name, assessment);
  }
  return JSON.stringify({
    schemaVersion: 1,
    plan: {
      concernSummary: "Concern",
      primaryField: "Example field",
      adjacentFields: ["Adjacent field"],
      venues: [...venueMap.values()],
      queries: [
        { query: "example problem", family: "problem", rationale: "direct" },
        { query: "example method", family: "method", rationale: "mechanism" },
        {
          query: "example evaluation",
          family: "evaluation",
          rationale: "results",
        },
      ],
      scopeSummary: "Broad search followed by paper-level verification.",
    },
    verifiedMain: papers,
    otherPeerReviewed: [],
    noveltyRadar: [],
    excluded: [],
    limitations: [],
    completedAt: "2026-08-12T00:00:00.000Z",
  });
}

function openReviewNotes(params: {
  forumID: string;
  decision?: string;
  venue?: string;
  venueID?: string;
  invitationPrefix?: string;
  officialReview?: boolean;
  extraNotes?: unknown[];
  title?: string;
  authors?: string[];
}) {
  const prefix = params.invitationPrefix || "Example.cc/2026/Conference";
  return [
    {
      id: params.forumID,
      forum: params.forumID,
      invitation: `${prefix}/-/Submission`,
      content: {
        ...(params.venue ? { venue: params.venue } : {}),
        ...(params.venueID ? { venueid: params.venueID } : {}),
        ...(params.title ? { title: params.title } : {}),
        ...(params.authors ? { authors: params.authors } : {}),
      },
    },
    ...(params.decision
      ? [
          {
            id: `${params.forumID}-decision`,
            forum: params.forumID,
            invitation: `${prefix}/Paper1/-/Decision`,
            content: { decision: params.decision },
          },
        ]
      : []),
    ...(params.officialReview
      ? [
          {
            id: `${params.forumID}-review`,
            forum: params.forumID,
            invitations: [`${prefix}/Paper1/-/Official_Review`],
            content: { review: { value: "Official review text" } },
          },
        ]
      : []),
    ...(params.extraNotes || []),
  ];
}

function openReviewFetch(params: {
  forumID: string;
  page: string;
  decision?: string;
  venue?: string;
  venueID?: string;
  invitationPrefix?: string;
  officialReview?: boolean;
  extraNotes?: unknown[];
}) {
  return (async (input: unknown) => {
    if (String(input).includes("openreview.net/notes?forum=")) {
      return new Response(JSON.stringify({ notes: openReviewNotes(params) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(params.page, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
}

// Models OpenReview's anti-bot gate: anonymous page loads of /forum redirect
// to a /challenge interstitial while the notes API keeps answering normally.
function openReviewChallengeFetch(params: {
  forumID: string;
  title?: string;
  authors?: string[];
  decision?: string;
  venue?: string;
  venueID?: string;
  invitationPrefix?: string;
  officialReview?: boolean;
  notesStatus?: number;
}) {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.includes("openreview.net/notes?forum=")) {
      if (params.notesStatus && params.notesStatus !== 200) {
        return new Response("unavailable", { status: params.notesStatus });
      }
      return new Response(JSON.stringify({ notes: openReviewNotes(params) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/challenge")) {
      return new Response(
        "<title>Just a moment…</title><main>Verifying you are human. openreview.net needs to review the security of your connection.</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    return new Response("", {
      status: 302,
      headers: {
        location: `https://openreview.net/challenge?redirect=${encodeURIComponent(
          `/forum?id=${params.forumID}`,
        )}`,
      },
    });
  }) as typeof fetch;
}

test("discovery keeps only high-confidence official main-track evidence in the primary lane", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper(),
      paper({
        candidateID: "workshop",
        title: "Workshop Paper",
        publicationClass: "verified_workshop",
        publicationEvidence: [
          {
            type: "scholarly_index",
            sourceName: "Index",
            url: "https://dblp.org/rec/workshop",
            observedTitle: "Workshop Paper",
            observedTrack: "Workshop",
            supports: ["identity", "published"],
          },
        ],
      }),
      paper({
        candidateID: "preprint",
        title: "Recent Preprint",
        publicationClass: "preprint_only",
        publicationEvidence: [],
        urls: ["https://arxiv.org/abs/2601.00001"],
      }),
      paper({
        candidateID: "rejected",
        title: "Rejected Paper",
        publicationClass: "rejected_or_withdrawn",
      }),
    ]),
  );

  assert.deepEqual(
    parsed.verifiedMain.map((entry) => entry.title),
    ["Verified Paper"],
  );
  assert.deepEqual(
    parsed.otherPeerReviewed.map((entry) => entry.title),
    ["Workshop Paper"],
  );
  assert.deepEqual(
    parsed.noveltyRadar.map((entry) => entry.title),
    ["Recent Preprint"],
  );
  assert.ok(
    parsed.excluded.some(
      (entry) =>
        entry.title === "Rejected Paper" &&
        entry.reason === "rejected_or_withdrawn",
    ),
  );
});

test("novelty-radar repositories do not have to appear in the leading-venue plan", () => {
  const payload = JSON.parse(
    result([
      paper(),
      paper({
        candidateID: "preprint",
        title: "Recent Preprint",
        venueName: "arXiv",
        publicationClass: "preprint_only",
        publicationEvidence: [],
        urls: ["https://arxiv.org/abs/2601.00001"],
        leadingVenueAssessment: {
          venueName: "arXiv",
          fields: ["example field"],
          judgment: "not_leading",
          confidence: "high",
          basis: "A preprint repository, not an archival conference venue.",
        },
      }),
    ]),
  );
  payload.plan.venues = payload.plan.venues.filter(
    (venue: { venueName: string }) => venue.venueName !== "arXiv",
  );

  const parsed = parseDiscoveryResult(JSON.stringify(payload));

  assert.deepEqual(
    parsed.noveltyRadar.map((entry) => entry.title),
    ["Recent Preprint"],
  );
  assert.deepEqual(
    parsed.plan.venues.map((venue) => venue.venueName),
    ["Example Conference"],
  );
});

test("a model label alone cannot qualify a main-conference paper", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper({
        title: "Unverified Main Claim",
        publicationEvidence: [
          {
            type: "scholarly_index",
            sourceName: "Index",
            url: "https://dblp.org/rec/example",
            observedTitle: "Unverified Main Claim",
            observedTrack: "Main Conference",
            checkedAt: "2026-08-12T00:00:00.000Z",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  assert.equal(parsed.verifiedMain.length, 0);
  assert.equal(parsed.otherPeerReviewed[0].title, "Unverified Main Claim");
  assert.equal(
    parsed.otherPeerReviewed[0].publicationClass,
    "published_track_unknown",
  );
});

test("a mislabeled workshop track and a retracted decision cannot enter the primary lane", () => {
  const mislabeledWorkshop = paper({
    candidateID: "mislabeled-workshop",
    title: "Mislabeled Workshop",
    track: "Workshop Paper",
    publicationEvidence: [
      {
        type: "official_proceedings",
        sourceName: "Official proceedings",
        url: "https://proceedings.example.org/workshop",
        observedTitle: "Mislabeled Workshop",
        observedTrack: "Workshop Paper",
        supports: ["identity", "published", "main_track"],
      },
    ],
  });
  const retracted = paper({
    candidateID: "retracted",
    title: "Retracted Paper",
    publicationEvidence: [
      {
        type: "official_decision",
        sourceName: "Official decision",
        url: "https://proceedings.example.org/retracted",
        observedTitle: "Retracted Paper",
        observedTrack: "Main Conference",
        observedDecision: "Retracted",
        supports: ["identity", "accepted", "main_track"],
      },
    ],
  });
  const parsed = parseDiscoveryResult(
    result([paper(), mislabeledWorkshop, retracted]),
  );
  assert.deepEqual(
    parsed.verifiedMain.map((entry) => entry.title),
    ["Verified Paper"],
  );
  assert.equal(
    parsed.otherPeerReviewed[0].publicationClass,
    "verified_workshop",
  );
  assert.ok(
    parsed.excluded.some(
      (entry) =>
        entry.title === "Retracted Paper" &&
        entry.reason === "rejected_or_withdrawn",
    ),
  );
});

test("official evidence must match the paper title and show a track", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper(),
      paper({
        title: "Mismatched Paper",
        publicationEvidence: [
          {
            type: "official_proceedings",
            sourceName: "Official proceedings",
            url: "https://proceedings.example.org/other",
            observedTitle: "A Different Paper",
            checkedAt: "2026-08-12T00:00:00.000Z",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  assert.deepEqual(
    parsed.verifiedMain.map((entry) => entry.title),
    ["Verified Paper"],
  );
  assert.ok(
    parsed.excluded.some((entry) => entry.title === "Mismatched Paper"),
  );
});

test("discovery deduplicates preprint and accepted versions by DOI", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper({ doi: "10.1000/example" }),
      paper({
        candidateID: "preprint-copy",
        title: "Verified Paper preprint",
        doi: "https://doi.org/10.1000/EXAMPLE",
        publicationClass: "preprint_only",
        publicationEvidence: [],
        urls: ["https://arxiv.org/abs/2601.00001"],
      }),
    ]),
  );
  assert.equal(
    parsed.verifiedMain.length +
      parsed.otherPeerReviewed.length +
      parsed.noveltyRadar.length,
    1,
  );
  assert.ok(parsed.excluded.some((entry) => entry.reason === "duplicate"));
  assert.equal(parsed.verifiedMain[0].publicationClass, "verified_main");
  assert.ok(
    parsed.verifiedMain[0].urls.includes("https://arxiv.org/abs/2601.00001"),
  );
});

test("discovery ignores agent-controlled provider-ID collisions and matches stable paper identity", () => {
  const base = paper({
    providerIDs: { openalex: "W1" },
    title: "A Paper: With Punctuation",
    authors: ["Ada Lovelace"],
  });
  assert.equal(
    areLikelySamePaper(base as any, {
      ...(base as any),
      doi: undefined,
      providerIDs: { openalex: "W1" },
      title: "Different index title",
    }),
    false,
  );
  assert.equal(
    areLikelySamePaper(base as any, {
      ...(base as any),
      doi: undefined,
      providerIDs: {},
      title: "A Paper With Punctuation",
      authors: ["A. Lovelace"],
    }),
    true,
  );
});

test("duplicate agent candidate IDs cannot cross-wire distinct paper rows", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper({ candidateID: "collision" }),
      paper({
        candidateID: "collision",
        title: "Distinct Verified Paper",
        authors: ["B. Researcher"],
        year: 2025,
        providerIDs: { source: "distinct" },
        urls: ["https://proceedings.example.org/distinct"],
        publicationEvidence: [
          {
            type: "official_proceedings",
            sourceName: "Official proceedings",
            url: "https://proceedings.example.org/distinct",
            observedTitle: "Distinct Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  assert.equal(parsed.verifiedMain.length, 2);
  assert.equal(
    new Set(parsed.verifiedMain.map((paper) => paper.candidateID)).size,
    2,
  );
});

test("ambiguous same-metadata rows remain separately addressable", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper({ candidateID: "collision" }),
      paper({
        candidateID: "collision",
        providerIDs: { source: "other" },
        urls: ["https://proceedings.example.org/paper-1-alternate"],
        publicationEvidence: [
          {
            type: "official_proceedings",
            sourceName: "Official proceedings",
            url: "https://proceedings.example.org/paper-1-alternate",
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  assert.equal(parsed.verifiedMain.length, 1);
  assert.equal(
    parsed.excluded.some((entry) => entry.reason === "duplicate"),
    true,
  );
});

test("discovery applies stable relationship ranking and hard result limits", () => {
  const entries = Array.from({ length: 13 }, (_, index) =>
    paper({
      candidateID: `rank-${index}`,
      providerIDs: { source: `rank-${index}` },
      title: `Ranked Paper ${String(index).padStart(2, "0")}`,
      relationship: index === 12 ? "direct" : "adjacent",
      publicationEvidence: [
        {
          type: "official_proceedings",
          sourceName: "Official proceedings",
          url: `https://proceedings.example.org/rank-${index}`,
          observedTitle: `Ranked Paper ${String(index).padStart(2, "0")}`,
          observedVenue: "Example Conference",
          observedTrack: "Main Conference",
          checkedAt: "2026-08-12T00:00:00.000Z",
          supports: ["identity", "published", "main_track"],
        },
      ],
    }),
  );
  const parsed = parseDiscoveryResult(result(entries));
  assert.equal(parsed.verifiedMain.length, 12);
  assert.match(parsed.verifiedMain[0].candidateID, /^paper:ranked paper 12:/);
  assert.ok(parsed.excluded.some((entry) => entry.reason === "result_limit"));
});

test("discovery rejects executable evidence URLs and invalid publication enums", () => {
  const parsed = parseDiscoveryResult(
    result([
      paper(),
      paper({
        candidateID: "bad-url",
        title: "Bad URL Claim",
        publicationEvidence: [
          {
            type: "official_proceedings",
            sourceName: "Unsafe",
            url: "javascript:alert(1)",
            observedTitle: "Bad URL Claim",
            observedTrack: "Main Conference",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
      paper({
        candidateID: "bad-enum",
        title: "Bad Enum Claim",
        publicationClass: "certainly_top_tier",
        publicationEvidence: [],
      }),
    ]),
  );
  assert.equal(parsed.verifiedMain.length, 1);
  assert.ok(
    parsed.excluded.some(
      (entry) =>
        entry.title === "Bad Enum Claim" &&
        entry.reason === "unsupported_claim",
    ),
  );
});

test("live evidence verification requires the official page to match the paper", async () => {
  const officialURL = "https://openreview.net/forum?id=verified-paper";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
      paper({
        candidateID: "published-peer",
        title: "Published Peer",
        publicationClass: "verified_journal",
        publicationEvidence: [
          {
            type: "scholarly_index",
            sourceName: "Index",
            url: "https://dblp.org/rec/published-peer",
            observedTitle: "Published Peer",
            supports: ["identity", "published"],
          },
        ],
      }),
    ]),
  );
  const matched = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "verified-paper",
      page: "<title>Example Conference</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
      decision: "Accept (Oral)",
      venue: "Example Conference Main Conference",
    }),
  });
  assert.equal(matched.verifiedMain.length, 1);

  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "verified-paper",
        page: "<title>A different work</title>",
        decision: "Accept (Oral)",
        venue: "Example Conference Main Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("OpenReview challenge interstitial verifies through the registrar notes API", async () => {
  const officialURL = "https://openreview.net/forum?id=challenge-paper";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewChallengeFetch({
      forumID: "challenge-paper",
      title: "Verified Paper",
      authors: ["A. Author"],
      decision: "Accept (Oral)",
      venue: "Example Conference Main Conference",
      venueID: "Example.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
  assert.ok(
    verified.verifiedMain[0].publicationEvidence.some(
      (entry) =>
        entry.url === officialURL &&
        entry.supports.includes("identity") &&
        entry.supports.includes("accepted") &&
        entry.supports.includes("main_track"),
    ),
  );
});

test("OpenReview challenge fallback still requires registrar identity to match", async () => {
  const officialURL = "https://openreview.net/forum?id=challenge-mismatch";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewChallengeFetch({
        forumID: "challenge-mismatch",
        title: "A Different Work Entirely",
        authors: ["B. Other"],
        decision: "Accept (Oral)",
        venue: "Example Conference Main Conference",
        venueID: "Example.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("OpenReview challenge fallback fails closed when the notes API is unavailable", async () => {
  const officialURL = "https://openreview.net/forum?id=challenge-outage";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewChallengeFetch({
        forumID: "challenge-outage",
        title: "Verified Paper",
        authors: ["A. Author"],
        decision: "Accept (Oral)",
        venue: "Example Conference Main Conference",
        venueID: "Example.cc/2026/Conference",
        notesStatus: 503,
      }),
    }),
    /did not include any usable papers/,
  );
});

test("challenge fallback rejects authors that only match venue words", async () => {
  const officialURL = "https://openreview.net/forum?id=challenge-authors";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        authors: ["C. Conference"],
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewChallengeFetch({
        forumID: "challenge-authors",
        title: "Verified Paper",
        authors: ["B. Other"],
        decision: "Accept (Oral)",
        venue: "Example Conference Main Conference",
        venueID: "Example.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("duplicate claimed surnames cannot satisfy the registrar author match", async () => {
  const officialURL = "https://openreview.net/forum?id=challenge-twins";
  const claim = (candidateID: string) =>
    paper({
      candidateID,
      authors: ["Alice Smith", "Bob Smith"],
      urls: [officialURL],
      publicationEvidence: [
        {
          type: "official_decision",
          sourceName: "OpenReview",
          url: officialURL,
          observedTitle: "Verified Paper",
          observedVenue: "Example Conference",
          observedTrack: "Main Conference",
          observedDecision: "Accepted",
          supports: ["identity", "accepted", "main_track"],
        },
      ],
    });
  const fetchWithAuthors = (authors: string[]) =>
    openReviewChallengeFetch({
      forumID: "challenge-twins",
      title: "Verified Paper",
      authors,
      decision: "Accept (Oral)",
      venue: "Example Conference Main Conference",
      venueID: "Example.cc/2026/Conference",
    });
  // One shared surname must not count twice against two claimed authors.
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery: parseDiscoveryResult(result([claim("twins-reject")])),
      fetch: fetchWithAuthors(["Mallory Smith", "Carol Brown"]),
    }),
    /did not include any usable papers/,
  );
  // Two genuine same-surname registrar authors still verify.
  const verified = await verifyDiscoveryEvidenceLive({
    discovery: parseDiscoveryResult(result([claim("twins-accept")])),
    fetch: fetchWithAuthors(["Alice Smith", "Bob Smith"]),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("higher spelled ordinals cannot mint fake venue aliases at parse time", () => {
  const officialURL = "https://openreview.net/forum?id=ordinal-sixty";
  const rejectAtParse = (venueName: string) => {
    const assessment = {
      venueName,
      fields: ["example field"],
      judgment: "leading",
      confidence: "high",
      basis: "Field-specific archival venue assessment.",
    };
    assert.throws(
      () =>
        parseDiscoveryResult(
          result([
            paper({
              venueName: "SILR",
              track: undefined,
              urls: [officialURL],
              publicationEvidence: [
                {
                  type: "official_decision",
                  sourceName: "OpenReview",
                  url: officialURL,
                  observedTitle: "Verified Paper",
                  observedVenue: "SILR",
                  observedTrack: "Poster",
                  observedDecision: "Accepted",
                  supports: ["identity", "accepted", "main_track"],
                },
              ],
              leadingVenueAssessment: assessment,
            }),
          ]),
        ),
      /did not include any usable papers/,
    );
  };
  rejectAtParse(
    "The Sixtieth International Conference on Learning Representations",
  );
  rejectAtParse(
    "The Sixty-First International Conference on Learning Representations",
  );
});

test("challenge fallback binds the claimed year to the registrar edition surface", async () => {
  const officialURL = "https://openreview.net/forum?id=challenge-2025";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        year: 2025,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  // The forum id and any registrar title digits must not satisfy the claimed
  // year; only the registrar venue/venueid/invitation edition surface may.
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewChallengeFetch({
        forumID: "challenge-2025",
        title: "Verified Paper",
        authors: ["A. Author"],
        decision: "Accept (Oral)",
        venue: "Example Conference Main Conference",
        venueID: "Example.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("spelled-ordinal initials cannot mint a fake venue alias", async () => {
  const officialURL = "https://openreview.net/forum?id=ordinal-alias";
  const assessment = {
    venueName:
      "The Twelfth International Conference on Learning Representations",
    fields: ["example field"],
    judgment: "leading",
    confidence: "high",
    basis: "Field-specific archival venue assessment.",
  };
  const discovery = () =>
    parseDiscoveryResult(
      result([
        paper({
          venueName: "TILR",
          track: undefined,
          urls: [officialURL],
          publicationEvidence: [
            {
              type: "official_decision",
              sourceName: "OpenReview",
              url: officialURL,
              observedTitle: "Verified Paper",
              observedVenue: "TILR",
              observedTrack: "Poster",
              observedDecision: "Accepted",
              supports: ["identity", "accepted", "main_track"],
            },
          ],
          leadingVenueAssessment: assessment,
        }),
      ]),
    );
  await assert.rejects(
    (async () =>
      verifyDiscoveryEvidenceLive({
        discovery: discovery(),
        fetch: openReviewFetch({
          forumID: "ordinal-alias",
          page: "<title>ICLR 2026</title><main>Verified Paper — A. Author — 2026 — ICLR 2026</main>",
          decision: "Accept (Poster)",
          venue: "ICLR 2026 Poster",
          venueID: "ICLR.cc/2026/Conference",
        }),
      }))(),
    /did not include any usable papers/,
  );
});

test("OpenReview reviewer prose cannot impersonate an official decision", async () => {
  const officialURL = "https://openreview.net/forum?id=review-prose";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            supports: ["identity", "accepted"],
          },
        ],
        publicationClass: "under_review_or_submission",
      }),
    ]),
  );
  const reviewerProse = {
    forumID: "review-prose",
    page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference. Reviewer comment: Decision: Accept — Venue: Main Conference.</main>",
    extraNotes: [
      {
        id: "review-prose-comment",
        forum: "review-prose",
        invitation: "Example.cc/2026/Conference/Paper1/-/Official_Comment",
        content: {
          comment: "Decision: Accept — Venue: Main Conference",
        },
      },
    ],
  };
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch(reviewerProse),
  });
  assert.equal(verified.verifiedMain.length, 0);
  assert.equal(verified.noveltyRadar.length, 1);

  const claimedMain = parseDiscoveryResult(
    result([
      paper({
        urls: ["https://openreview.net/forum?id=review-prose"],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: "https://openreview.net/forum?id=review-prose",
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery: claimedMain,
      fetch: openReviewFetch(reviewerProse),
    }),
    /did not include any usable papers/,
  );
});

test("an official OpenReview decision cannot ride a prose-only venue match", async () => {
  const officialURL = "https://openreview.net/forum?id=wrong-venue";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "wrong-venue",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
        decision: "Accept (Poster)",
        venue: "Unrelated Symposium 2026 Poster",
        invitationPrefix: "UnrelatedSymposium.org/2026/Symposium",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("official OpenReview status accepts a full venue name against acronym ids", async () => {
  const officialURL = "https://openreview.net/forum?id=full-name";
  const fullName = "International Conference on Learning Representations";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: fullName,
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: fullName,
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: fullName,
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "full-name",
      page: `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ${fullName}</main>`,
      decision: "Accept (Poster)",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("edition-bearing full venue names still bind to acronym ids", async () => {
  const officialURL = "https://openreview.net/forum?id=edition-name";
  const editionName =
    "International Conference on Learning Representations 2026";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: editionName,
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: editionName,
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: editionName,
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "edition-name",
      page: `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ${editionName}</main>`,
      decision: "Accept (Poster)",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("a generic single-word venue claim cannot bind an official decision", async () => {
  const officialURL = "https://openreview.net/forum?id=generic-word";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: "Meeting",
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Meeting",
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: "Meeting",
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "generic-word",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Meeting</main>",
        decision: "Accept (Poster)",
        venue: "Example Meeting 2026 Poster",
        invitationPrefix: "ExampleMeeting.org/2026/Meeting",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("shared initials cannot bind a claim across different full venue names", async () => {
  const officialURL = "https://openreview.net/forum?id=initials-collision";
  const claimedName = "International Conference on Learning Research";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: claimedName,
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: claimedName,
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: claimedName,
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "initials-collision",
        page: `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ${claimedName}</main>`,
        decision: "Accept (Poster)",
        venue:
          "International Conference on Learning Representations 2026 Poster",
        invitationPrefix: "ICLR.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("a generic multi-word claim cannot bind a distinctive official venue", async () => {
  const officialURL = "https://openreview.net/forum?id=generic-phrase";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: "International Conference",
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "International Conference",
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: "International Conference",
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "generic-phrase",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — International Conference</main>",
        decision: "Accept (Poster)",
        venue:
          "International Conference on Learning Representations 2026 Poster",
        invitationPrefix: "ICLR.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("a venueid cannot bridge initials across different full venue names", async () => {
  const officialURL = "https://openreview.net/forum?id=venueid-collision";
  const claimedName = "International Conference on Learning Research";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: claimedName,
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: claimedName,
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: claimedName,
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "venueid-collision",
        page: `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ${claimedName}</main>`,
        decision: "Accept (Poster)",
        venue:
          "International Conference on Learning Representations 2026 Poster",
        venueID: "ICLR.cc/2026/Conference",
        invitationPrefix: "ICLR.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

function openReviewVenueClaimPaper(params: {
  url: string;
  venueName: string;
  venueAcronym?: string;
}) {
  return paper({
    venueName: params.venueName,
    venueAcronym: params.venueAcronym,
    urls: [params.url],
    publicationEvidence: [
      {
        type: "official_decision",
        sourceName: "OpenReview",
        url: params.url,
        observedTitle: "Verified Paper",
        observedVenue: params.venueName,
        observedTrack: "Poster",
        observedDecision: "Accepted",
        supports: ["identity", "accepted", "main_track"],
      },
    ],
    leadingVenueAssessment: {
      venueName: params.venueName,
      ...(params.venueAcronym ? { venueAcronym: params.venueAcronym } : {}),
      fields: ["example field"],
      judgment: "leading",
      confidence: "high",
      basis: "Field-specific archival venue assessment.",
    },
  });
}

test("a correct assessment cannot rescue conflicting paper venue metadata", async () => {
  const officialURL = "https://openreview.net/forum?id=cross-source";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: "International Symposium on Learning Representations",
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue:
              "International Conference on Learning Representations",
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: "International Conference on Learning Representations",
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "cross-source",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — International Symposium on Learning Representations</main>",
        decision: "Accept (Poster)",
        venue:
          "International Conference on Learning Representations 2026 Poster",
        venueID: "ICLR.cc/2026/Conference",
        invitationPrefix: "ICLR.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("acronym-only agreement records the registrar token without any acronym field", async () => {
  const officialURL = "https://openreview.net/forum?id=no-acronym-expansion";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName: "International Conference on Learning Research",
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "no-acronym-expansion",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — International Conference on Learning Research</main>",
      decision: "Accept (Poster)",
      venue: "ICLR 2026 Poster",
      venueID: "ICLR.cc/2026/Conference",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
  assert.equal(
    verified.verifiedMain[0].publicationEvidence[0].observedVenue,
    "ICLR",
  );
});

test("descriptive parentheticals stay distinctive and can conflict", async () => {
  const officialURL = "https://openreview.net/forum?id=parenthetical-conflict";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName: "Conference on Trustworthy Learning (Security)",
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "parenthetical-conflict",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Conference on Trustworthy Learning (Security)</main>",
        decision: "Accept (Poster)",
        venue: "Conference on Trustworthy Learning (Healthcare) 2026 Poster",
        invitationPrefix: "TrustworthyLearning.org/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("spelled ordinals in the claimed name do not block acronym agreement", async () => {
  const officialURL = "https://openreview.net/forum?id=claim-ordinal";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName:
          "The Twelfth International Conference on Learning Representations",
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "claim-ordinal",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — The Twelfth International Conference on Learning Representations</main>",
      decision: "Accept (Poster)",
      venue: "ICLR 2026 Poster",
      venueID: "ICLR.cc/2026/Conference",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("a shared modifier cannot override a venue-type disagreement", async () => {
  const officialURL = "https://openreview.net/forum?id=type-conflict";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName: "International Symposium on Learning Representations",
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "type-conflict",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — International Symposium on Learning Representations</main>",
        decision: "Accept (Poster)",
        venue:
          "International Conference on Learning Representations 2026 Poster",
        venueID: "ICLR.cc/2026/Conference",
        invitationPrefix: "ICLR.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("an initials-inconsistent claimed name cannot be rescued by an acronym", async () => {
  const officialURL = "https://openreview.net/forum?id=unrelated-name";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName: "Quantum Biology Conference",
        venueAcronym: "ICLR",
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "unrelated-name",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Quantum Biology Conference</main>",
        decision: "Accept (Poster)",
        venue: "ICLR 2026 Poster",
        venueID: "ICLR.cc/2026/Conference",
        invitationPrefix: "ICLR.cc/2026/Conference",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("an unverified same-initials expansion is recorded as the verified acronym", async () => {
  const officialURL = "https://openreview.net/forum?id=unverified-expansion";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName: "International Conference on Learning Research",
        venueAcronym: "ICLR",
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "unverified-expansion",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — International Conference on Learning Research</main>",
      decision: "Accept (Poster)",
      venue: "ICLR 2026 Poster",
      venueID: "ICLR.cc/2026/Conference",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  // The claimed expansion cannot be verified against an acronym-style field,
  // so the evidence endorses only the registrar-verified acronym.
  assert.equal(verified.verifiedMain.length, 1);
  assert.equal(
    verified.verifiedMain[0].publicationEvidence[0].observedVenue,
    "ICLR",
  );
});

test("a parenthetical acronym does not poison full-name agreement", async () => {
  const officialURL = "https://openreview.net/forum?id=parenthetical";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName:
          "International Conference on Learning Representations (ICLR)",
        venueAcronym: "ICLR",
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "parenthetical",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — International Conference on Learning Representations (ICLR)</main>",
      decision: "Accept (Poster)",
      venue: "International Conference on Learning Representations 2026 Poster",
      venueID: "ICLR.cc/2026/Conference",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("spelled edition ordinals do not block official venue agreement", async () => {
  const officialURL = "https://openreview.net/forum?id=spelled-ordinal";
  const fullName = "International Conference on Learning Representations";
  const discovery = parseDiscoveryResult(
    result([
      openReviewVenueClaimPaper({
        url: officialURL,
        venueName: fullName,
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "spelled-ordinal",
      page: `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ${fullName}</main>`,
      decision: "Accept (Poster)",
      venue:
        "The Twelfth International Conference on Learning Representations 2026 Poster",
      venueID: "ICLR.cc/2026/Conference",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("an acronym claim binds a spelled-out official venue through registrar ids", async () => {
  const officialURL = "https://openreview.net/forum?id=acronym-claim";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: "ICLR",
        venueAcronym: "ICLR",
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "ICLR",
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: "ICLR",
          venueAcronym: "ICLR",
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "acronym-claim",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ICLR</main>",
      decision: "Accept (Poster)",
      venue: "International Conference on Learning Representations 2026 Poster",
      venueID: "ICLR.cc/2026/Conference",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("an acronym-style official venue field accepts the full-name claim", async () => {
  const officialURL = "https://openreview.net/forum?id=acronym-field";
  const fullName = "International Conference on Learning Representations";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        venueName: fullName,
        venueAcronym: undefined,
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: fullName,
            observedTrack: "Poster",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
        leadingVenueAssessment: {
          venueName: fullName,
          fields: ["example field"],
          judgment: "leading",
          confidence: "high",
          basis: "Field-specific archival venue assessment.",
        },
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "acronym-field",
      page: `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — ${fullName}</main>`,
      decision: "Accept (Poster)",
      venue: "ICLR 2026 Poster",
      invitationPrefix: "ICLR.cc/2026/Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("a similarly named venue's official decision cannot validate the claim", async () => {
  const officialURL = "https://openreview.net/forum?id=similar-name";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: openReviewFetch({
        forumID: "similar-name",
        page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
        decision: "Accept (Poster)",
        venue: "Example Symposium 2026 Poster",
        invitationPrefix: "ExampleSymposium.org/2026/Symposium",
      }),
    }),
    /did not include any usable papers/,
  );
});

test("a bare OpenReview acceptance without a track marker stays track-unknown", async () => {
  const officialURL = "https://openreview.net/forum?id=bare-accept";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialURL],
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: officialURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "bare-accept",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
      decision: "Accept",
      venue: "Example Conference",
    }),
  });
  assert.equal(verified.verifiedMain.length, 0);
  assert.equal(
    verified.otherPeerReviewed[0]?.publicationClass,
    "published_track_unknown",
  );
});

test("live submission evidence preserves an identity-bound OpenReview forum", async () => {
  const forum = "https://openreview.net/forum?id=active-submission";
  const submission = paper({
    publicationClass: "under_review_or_submission",
    urls: [forum],
    publicationEvidence: [
      {
        type: "official_decision",
        sourceName: "OpenReview",
        url: forum,
        supports: ["identity", "reviews_available"],
      },
    ],
  });
  const discovery = parseDiscoveryResult(result([submission]));
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    providerCandidates: [
      {
        provider: "openalex",
        providerID: "W1",
        title: "Verified Paper",
        authors: ["A. Author"],
        year: 2026,
        urls: ["https://openalex.org/W1"],
      },
    ],
    fetch: openReviewFetch({
      forumID: "active-submission",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
      officialReview: true,
    }),
  });
  assert.equal(verified.noveltyRadar.length, 1);
  assert.ok(
    verified.noveltyRadar[0].publicationEvidence.some(
      (entry) => entry.type === "official_decision" && entry.url === forum,
    ),
  );
});

test("a provider match cannot validate an unrelated repository URL", async () => {
  const preprint = paper({
    publicationClass: "preprint_only",
    urls: ["https://arxiv.org/abs/9999.99999"],
    publicationEvidence: [],
  });
  const discovery = parseDiscoveryResult(result([preprint]));
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      providerCandidates: [
        {
          provider: "openalex",
          providerID: "W1",
          title: "Verified Paper",
          authors: ["A. Author"],
          year: 2026,
          urls: ["https://openalex.org/W1"],
        },
      ],
    }),
    /usable papers/i,
  );
});

test("malformed DOI text cannot bypass author and year identity", () => {
  assert.throws(
    () =>
      parseDiscoveryResult(
        result([paper({ doi: "iclr", authors: [], urls: [] })]),
      ),
    /usable papers/i,
  );
});

test("a copied DOI absent from the official page cannot replace author identity", () => {
  const inspection: Parameters<typeof reconstructOfficialEvidence>[1] = {
    url: "https://proceedings.mlr.press/v300/verified.html",
    hostname: "proceedings.mlr.press",
    sourceFamily: "pmlr",
    pageTitle: "Verified Paper",
    searchableText: "Verified Paper — 2026 — Example Conference — Poster",
    linkedHostnames: [],
    contentType: "text/html",
    checkedAt: "2026-08-17T00:00:00.000Z",
    bodyInspected: true,
  };
  const copied = paper({
    authors: [],
    doi: "10.9999/copied-from-another-paper",
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  assert.equal(reconstructOfficialEvidence(copied, inspection), undefined);

  const onPageDOI = reconstructOfficialEvidence(copied, {
    ...inspection,
    searchableText:
      "Verified Paper — 2026 — Example Conference — Poster — DOI: 10.9999/copied-from-another-paper",
  });
  assert.ok(onPageDOI?.supports.includes("identity"));
});

test("dedup follows DOI, trusted stable identity, and compatible title years", () => {
  const base = parseDiscoveryResult(result([paper()])).verifiedMain[0];
  const merged = deduplicateDiscoveredPapers([
    { ...base, candidateID: "agent-a", year: 2025 },
    { ...base, candidateID: "agent-b", year: 2026 },
  ]);
  assert.equal(merged.papers.length, 1);
  assert.equal(
    areLikelySamePaper(
      { ...base, providerIDs: { openalex: "W1" } },
      { ...base, title: "Different metadata", providerIDs: { openalex: "W1" } },
      { trustProviderIDs: true },
    ),
    false,
  );
});

test("a copied DOI cannot merge materially conflicting paper identities", () => {
  assert.equal(
    areLikelySamePaper(
      {
        title: "Real Paper",
        authors: ["Alice Author"],
        year: 2026,
        doi: "10.1234/shared",
        providerIDs: {},
      },
      {
        title: "Completely Different",
        authors: ["Bob Other"],
        year: 1999,
        doi: "10.1234/shared",
        providerIDs: {},
      },
    ),
    false,
  );
});

test("live verification reconstructs track and rejection instead of trusting agent evidence", async () => {
  const discovery = parseDiscoveryResult(result([paper()]));
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          "<title>Verified Paper</title><main>Verified Paper — Example Conference — Workshop submission — rejected</main>",
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    }),
    /did not include any usable papers/,
  );
});

test("live verification discards unbound agent landing URLs", async () => {
  const official = "https://proceedings.mlr.press/v300/verified.html";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [official, "https://attacker.example/phish"],
        providerIDs: {},
        publicationEvidence: [
          {
            type: "official_proceedings",
            sourceName: "PMLR",
            url: official,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Poster",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: (async () =>
      new Response(
        "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference — Poster</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });
  assert.deepEqual(verified.verifiedMain[0].urls, [official]);
});

test("provider partial-failure limitations survive live verification", async () => {
  const official = "https://proceedings.mlr.press/v300/verified.html";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [official],
        providerIDs: {},
        publicationEvidence: [
          {
            type: "official_proceedings",
            sourceName: "PMLR",
            url: official,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Poster",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    limitations: [
      "Live scholarly provider openalex failed: request timed out.",
      "Live scholarly provider openalex failed: request timed out.",
    ],
    fetch: (async () =>
      new Response(
        "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference — Poster</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });
  assert.equal(verified.verifiedMain.length, 1);
  assert.equal(
    verified.limitations.filter((entry) => /openalex failed/i.test(entry))
      .length,
    1,
  );
});

test("a citation on an unrelated proceedings page cannot become the primary record", () => {
  const candidate = paper({
    title: "Verified Machine Paper With Long Title",
    authors: ["Alice Author"],
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  assert.equal(
    reconstructOfficialEvidence(candidate, {
      url: "https://proceedings.mlr.press/v999/unrelated.html",
      hostname: "proceedings.mlr.press",
      sourceFamily: "pmlr",
      pageTitle: "Completely Different Paper — Example Conference 2026",
      searchableText:
        "Completely Different Paper — Bob Other — 2026. References: Verified Machine Paper With Long Title — Alice Author — 2026 — poster.",
      linkedHostnames: [],
      contentType: "text/html",
      checkedAt: "2026-08-14T00:00:00.000Z",
      bodyInspected: true,
    }),
    undefined,
  );
});

test("official program listing is sufficient acceptance evidence without boilerplate accepted text", async () => {
  const officialProgramURL = "https://exampleconference.org/program";
  const publisherURL = "https://dl.acm.org/doi/10.5555/example";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialProgramURL],
        publicationEvidence: [
          {
            type: "official_program",
            sourceName: "Conference program",
            url: officialProgramURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
          {
            type: "publisher_proceedings",
            sourceName: "ACM Digital Library",
            url: publisherURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            supports: ["identity", "published"],
          },
        ],
      }),
    ]),
  );

  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: (async (input) =>
      new Response(
        String(input) === publisherURL
          ? '<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference <a href="https://exampleconference.org/program">Official program</a></main>'
          : "<title>Example Conference Main Program</title><main>Session 2A — Verified Paper — A. Author — 2026</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });

  assert.equal(verified.verifiedMain.length, 1);
  assert.equal(
    verified.verifiedMain[0].publicationEvidence[0].observedDecision,
    "Listed in official program",
  );
});

test("a registered venue program binds entry authors to edition year", () => {
  const candidate = paper({
    title: "Adaptive Insertion Policies for High Performance Caching",
    authors: ["Moinuddin K. Qureshi", "Aamer Jaleel"],
    year: 2007,
    venueName: "International Symposium on Computer Architecture",
    venueAcronym: "ISCA",
    leadingVenueAssessment: {
      venueName: "International Symposium on Computer Architecture",
      venueAcronym: "ISCA",
      fields: ["computer architecture"],
      judgment: "leading",
      confidence: "high",
      basis: "Flagship archival computer architecture venue.",
    },
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  const evidence = reconstructOfficialEvidence(candidate, {
    url: "https://iscaconf.org/isca2007/program.html",
    hostname: "iscaconf.org",
    sourceFamily: "isca",
    pageTitle: "ISCA 2007 Main Program",
    searchableText:
      "SESSION 8-A: MEMORY AND CACHES Adaptive Insertion Policies for High Performance Caching Moinuddin K Qureshi, University of Texas Aamer Jaleel, Intel",
    linkedHostnames: [],
    contentType: "text/html",
    checkedAt: "2026-08-14T00:00:00.000Z",
    bodyInspected: true,
  });
  assert.ok(evidence?.supports.includes("accepted"));
  assert.ok(evidence?.supports.includes("main_track"));
});

test("official workshop program cannot be inferred as a main-track listing", async () => {
  const officialProgramURL = "https://conference.example.org/workshops/program";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [officialProgramURL],
        publicationEvidence: [
          {
            type: "official_program",
            sourceName: "Conference program",
            url: officialProgramURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );

  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          "<title>Example Conference workshop program</title><main>Workshop session — Verified Paper</main>",
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    }),
    /did not include any usable papers/,
  );
});

test("public review links remain hidden until a live official-page recheck", async () => {
  const reviewURL = "https://openreview.net/forum?id=verified-paper";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [reviewURL],
        reviewURL,
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: reviewURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: [
              "identity",
              "accepted",
              "main_track",
              "reviews_available",
            ],
          },
        ],
      }),
    ]),
  );
  assert.equal(discovery.verifiedMain[0].reviewURL, undefined);

  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: openReviewFetch({
      forumID: "verified-paper",
      page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
      decision: "Accept (Oral)",
      venue: "Example Conference Main Conference",
      officialReview: true,
    }),
  });
  assert.equal(verified.verifiedMain[0].reviewURL, reviewURL);
});

test("live verification ignores an agent review URL that the official page redirects away from", async () => {
  const claimedReviewURL = "https://openreview.net/forum?id=claimed";
  const actualReviewURL = "https://openreview.net/forum?id=actual";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [claimedReviewURL],
        reviewURL: claimedReviewURL,
        publicationEvidence: [
          {
            type: "official_decision",
            sourceName: "OpenReview",
            url: claimedReviewURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: [
              "identity",
              "accepted",
              "main_track",
              "reviews_available",
            ],
          },
        ],
      }),
    ]),
  );
  const actualFetch = openReviewFetch({
    forumID: "actual",
    page: "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>",
    decision: "Accept (Oral)",
    venue: "Example Conference Main Conference",
    officialReview: true,
  });
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: (async (input: unknown, init?: unknown) => {
      if (String(input) === claimedReviewURL) {
        return new Response(null, {
          status: 302,
          headers: { location: actualReviewURL },
        });
      }
      return actualFetch(input as never, init as never);
    }) as typeof fetch,
  });
  assert.equal(verified.verifiedMain[0].reviewURL, actualReviewURL);
  assert.match(
    verified.verifiedMain[0].publicationEvidence[0].url,
    /forum\?id=actual/,
  );
});

test("live verification rejects same-title author/year conflicts", async () => {
  const discovery = parseDiscoveryResult(result([paper()]));
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          "<title>Verified Paper</title><main>Verified Paper — B. Other — 2024 — Example Conference — Main Conference — accepted</main>",
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    }),
    /did not include any usable papers/,
  );
});

test("live verification binds authors and year to the matching title entry", () => {
  const candidate = paper({
    authors: ["Bob Candidate"],
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  const reconstructed = reconstructOfficialEvidence(
    candidate,
    {
      url: "https://exampleconference.org/program",
      hostname: "exampleconference.org",
      sourceFamily: "generic-official-web",
      pageTitle: "Example Conference Main Program",
      searchableText: `Verified Paper — Alice Author — 2026 — accepted ${"session details ".repeat(60)} Bob Candidate — 2026`,
      linkedHostnames: [],
      contentType: "text/html",
      checkedAt: "2026-08-14T00:00:00.000Z",
      bodyInspected: true,
    },
    { authorityValidated: true },
  );
  assert.equal(reconstructed, undefined);
});

test("short venue acronyms require token boundaries", () => {
  const candidate = paper({
    title: "A Machine Study",
    venueName: "Conference on Human Factors in Computing Systems",
    venueAcronym: "CHI",
    leadingVenueAssessment: {
      venueName: "Conference on Human Factors in Computing Systems",
      venueAcronym: "CHI",
      fields: ["HCI"],
      judgment: "leading",
      confidence: "high",
      basis: "Selective archival HCI venue.",
    },
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  assert.equal(
    reconstructOfficialEvidence(candidate, {
      url: "https://proceedings.mlr.press/v300/machine.html",
      hostname: "proceedings.mlr.press",
      sourceFamily: "pmlr",
      pageTitle: "Different Venue Proceedings",
      searchableText: "A Machine Study — A. Author — 2026 — Poster",
      linkedHostnames: [],
      contentType: "text/html",
      checkedAt: "2026-08-14T00:00:00.000Z",
      bodyInspected: true,
    }),
    undefined,
  );
});

test("short paper titles verify only with exact token and identity corroboration", () => {
  const candidate = paper({
    title: "DINO",
    authors: ["Alice Author"],
    doi: "10.1234/dino",
    urls: ["https://proceedings.mlr.press/v300/dino.html"],
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  const evidence = reconstructOfficialEvidence(candidate, {
    url: "https://proceedings.mlr.press/v300/dino.html",
    hostname: "proceedings.mlr.press",
    sourceFamily: "pmlr",
    pageTitle: "DINO",
    searchableText:
      "DINO — Alice Author — 2026 — DOI: 10.1234/dino — Example Conference — Poster",
    linkedHostnames: [],
    contentType: "text/html",
    checkedAt: "2026-08-14T00:00:00.000Z",
    bodyInspected: true,
  });
  assert.ok(evidence?.supports.includes("identity"));
  assert.ok(evidence?.supports.includes("main_track"));
});

test("generic official pages require venue-owned structural authority", async () => {
  const discovery = parseDiscoveryResult(result([paper()]));
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          "<title>Personal page</title><main>Verified Paper — A. Author — 2026 — Example Conference — main conference — accepted</main>",
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    }),
    /did not include any usable papers/,
  );

  const attackerSubdomain = reconstructOfficialEvidence(
    paper({
      venueName: "ISCA",
      venueAcronym: "ISCA",
      leadingVenueAssessment: {
        venueName: "ISCA",
        venueAcronym: "ISCA",
        fields: ["computer architecture"],
        judgment: "leading",
        confidence: "high",
        basis: "A principal archival computer architecture venue.",
      },
    }) as Parameters<typeof reconstructOfficialEvidence>[0],
    {
      url: "https://isca.attacker.example/program",
      hostname: "isca.attacker.example",
      sourceFamily: "generic-official-web",
      pageTitle: "ISCA 2026 Main Program",
      searchableText:
        "Verified Paper — A. Author — 2026 — ISCA — accepted main conference",
      linkedHostnames: [],
      contentType: "text/html",
      checkedAt: "2026-08-14T00:00:00.000Z",
      bodyInspected: true,
    },
  );
  assert.equal(attackerSubdomain, undefined);

  const lookalikeURL = "https://personal.example/program";
  const lookalike = parseDiscoveryResult(
    result([
      paper({
        urls: [lookalikeURL],
        publicationEvidence: [
          {
            type: "official_program",
            sourceName: "Claimed program",
            url: lookalikeURL,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery: lookalike,
      fetch: (async () =>
        new Response(
          "<title>Example Conference Program</title><main>Example Conference program — Main Conference — Verified Paper — A. Author — 2026</main>",
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    }),
    /did not include any usable papers/,
  );
});

test("an unseen venue can verify through an independently bound official domain", async () => {
  const url = "https://new-archival-venue.org/program/paper-7";
  const unseen = paper({
    venueName: "New Archival Venue",
    venueAcronym: "NAV",
    providerIDs: {},
    urls: [url],
    publicationEvidence: [
      {
        type: "official_program",
        sourceName: "Venue program",
        url,
        observedTitle: "Verified Paper",
        observedVenue: "New Archival Venue",
        observedTrack: "Main Conference",
        observedDecision: "Listed in official program",
        supports: ["identity", "accepted", "main_track"],
      },
    ],
    leadingVenueAssessment: {
      venueName: "New Archival Venue",
      venueAcronym: "NAV",
      fields: ["emerging field"],
      judgment: "leading",
      confidence: "high",
      basis: "Selective archival venue with field-specific evidence.",
    },
  });
  const verified = await verifyDiscoveryEvidenceLive({
    discovery: parseDiscoveryResult(result([unseen])),
    fetch: (async () =>
      new Response(
        "<title>New Archival Venue 2026 Program</title><main>Verified Paper — A. Author — 2026 — New Archival Venue — Track: Main Conference — accepted</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });
  assert.equal(verified.verifiedMain.length, 1);
});

test("a venue-named subdomain on another registered domain earns no authority", async () => {
  for (const hostname of [
    "new-archival-venue.shared-platform.org",
    "nav.shared-platform.org",
    "nav-fake.org",
  ]) {
    const url = `https://${hostname}/program/paper-7`;
    const unseen = paper({
      venueName: "New Archival Venue",
      venueAcronym: "NAV",
      providerIDs: {},
      urls: [url],
      publicationEvidence: [
        {
          type: "official_program",
          sourceName: "Venue program",
          url,
          observedTitle: "Verified Paper",
          observedVenue: "New Archival Venue",
          observedTrack: "Main Conference",
          observedDecision: "Listed in official program",
          supports: ["identity", "accepted", "main_track"],
        },
      ],
      leadingVenueAssessment: {
        venueName: "New Archival Venue",
        venueAcronym: "NAV",
        fields: ["emerging field"],
        judgment: "leading",
        confidence: "high",
        basis: "Selective archival venue with field-specific evidence.",
      },
    });
    await assert.rejects(
      verifyDiscoveryEvidenceLive({
        discovery: parseDiscoveryResult(result([unseen])),
        fetch: (async () =>
          new Response(
            "<title>New Archival Venue 2026 Program</title><main>Verified Paper — A. Author — 2026 — New Archival Venue — Track: Main Conference — accepted</main>",
            { status: 200, headers: { "content-type": "text/html" } },
          )) as typeof fetch,
      }),
      /usable papers/i,
      hostname,
    );
  }
});

test("a far workshop scope cannot inherit a page-global main-program label", async () => {
  const url = "https://exampleconference.org/program";
  const discovery = parseDiscoveryResult(
    result([
      paper({
        urls: [url],
        publicationEvidence: [
          {
            type: "official_program",
            sourceName: "Program",
            url,
            observedTitle: "Verified Paper",
            observedVenue: "Example Conference",
            observedTrack: "Main Conference",
            observedDecision: "Accepted",
            supports: ["identity", "accepted", "main_track"],
          },
        ],
      }),
    ]),
  );
  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          `<title>Example Conference Main Program</title><main>Workshop on Systems ${"schedule ".repeat(300)} Session W1 — Verified Paper — A. Author — 2026</main>`,
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    }),
    /did not include any usable papers/,
  );
});

test("a nearby previous row and abstract prose cannot supply main-track evidence", () => {
  const candidate = paper() as Parameters<
    typeof reconstructOfficialEvidence
  >[0];
  for (const searchableText of [
    `Session 1 Main conference paper Previous Paper — P. Author — 2026 ${"schedule ".repeat(40)} Verified Paper — A. Author — 2026`,
    "Verified Paper — A. Author — 2026 — Example Conference — our abstract evaluates the main program implementation",
  ]) {
    const evidence = reconstructOfficialEvidence(
      candidate,
      {
        url: "https://exampleconference.org/program",
        hostname: "exampleconference.org",
        sourceFamily: "generic-official-web",
        pageTitle: "Example Conference Program",
        searchableText,
        linkedHostnames: [],
        contentType: "text/html",
        checkedAt: "2026-08-14T00:00:00.000Z",
        bodyInspected: true,
      },
      { authorityValidated: true },
    );
    assert.equal(evidence?.supports.includes("main_track"), false);
  }
});

test("known official oral and poster decisions require a non-workshop scope", async () => {
  for (const [url, label] of [
    ["https://openreview.net/forum?id=paper", "Poster"],
    ["https://proceedings.neurips.cc/paper/2026/hash/paper.html", "Oral"],
    ["https://proceedings.mlr.press/v300/paper.html", "Poster"],
  ] as const) {
    const discovery = parseDiscoveryResult(
      result([
        paper({
          urls: [url],
          publicationEvidence: [
            {
              type: url.includes("openreview")
                ? "official_decision"
                : "official_proceedings",
              sourceName: "Official source",
              url,
              observedTitle: "Verified Paper",
              observedVenue: "Example Conference",
              observedTrack: label,
              observedDecision: "Accepted",
              supports: ["identity", "accepted", "main_track"],
            },
          ],
        }),
      ]),
    );
    const identityPage =
      "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference</main>";
    const verified = await verifyDiscoveryEvidenceLive({
      discovery,
      fetch: url.includes("openreview")
        ? openReviewFetch({
            forumID: "paper",
            page: identityPage,
            decision: `Accept (${label})`,
            venue: "Example Conference Main Conference",
          })
        : ((async () =>
            new Response(
              `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference — accepted ${label}</main>`,
              { status: 200, headers: { "content-type": "text/html" } },
            )) as typeof fetch),
    });
    assert.equal(verified.verifiedMain.length, 1, url);

    const workshop = await verifyDiscoveryEvidenceLive({
      discovery,
      fetch: url.includes("openreview")
        ? openReviewFetch({
            forumID: "paper",
            page: identityPage,
            decision: `Accept (${label})`,
            venue: "Example Conference Workshop poster",
          })
        : ((async () =>
            new Response(
              `<title>Verified Paper</title><main>Workshop poster — Example Conference — accepted ${label} — Verified Paper — A. Author — 2026</main>`,
              { status: 200, headers: { "content-type": "text/html" } },
            )) as typeof fetch),
    });
    assert.equal(workshop.verifiedMain.length, 0, url);
    assert.equal(
      workshop.otherPeerReviewed[0]?.publicationClass,
      "verified_workshop",
    );
  }
});

test("the canonical venue plan governs paper-local leading judgments", () => {
  const payload = JSON.parse(result([paper()]));
  payload.plan.venues[0].judgment = "unknown";
  payload.plan.venues[0].confidence = "low";
  const parsed = parseDiscoveryResult(JSON.stringify(payload));
  assert.equal(parsed.verifiedMain.length, 0);
  assert.equal(
    parsed.otherPeerReviewed[0].leadingVenueAssessment.judgment,
    "unknown",
  );

  const conflicting = JSON.parse(
    result([paper(), paper({ title: "Conflicting Paper" })]),
  );
  conflicting.verifiedMain[1].venueName = "Ordinary Symposium";
  conflicting.verifiedMain[1].leadingVenueAssessment = {
    venueName: "Ordinary Symposium",
    fields: ["example field"],
    judgment: "leading",
    confidence: "high",
    basis: "Field-specific archival venue assessment.",
  };
  const partial = parseDiscoveryResult(JSON.stringify(conflicting));
  assert.deepEqual(
    partial.verifiedMain.map((entry) => entry.title),
    ["Verified Paper"],
  );
  assert.match(
    partial.parseWarnings.join(" "),
    /Conflicting Paper.*bounded venue plan/,
  );
});

test("live evidence keeps the canonical venue when an official page uses an edition alias", () => {
  const candidate = paper({
    title:
      "Back to the Future: Leveraging Belady's Algorithm for Improved Cache Replacement",
    authors: ["Akanksha Jain", "Calvin Lin"],
    year: 2016,
    venueName: "ISCA 2016",
    venueAcronym: "ISCA",
    leadingVenueAssessment: {
      venueName: "International Symposium on Computer Architecture",
      venueAcronym: "ISCA",
      judgment: "leading",
      confidence: "high",
      basis: "A principal archival computer architecture venue.",
    },
  }) as Parameters<typeof reconstructOfficialEvidence>[0];
  const evidence = reconstructOfficialEvidence(
    candidate,
    {
      url: "https://isca-conf.org/isca2016/program/",
      hostname: "isca-conf.org",
      sourceFamily: "generic-official-web",
      pageTitle: "ISCA 2016 Main Program",
      searchableText:
        "Main Program Back to the Future: Leveraging Belady's Algorithm for Improved Cache Replacement Akanksha Jain Calvin Lin 2016 accepted",
      linkedHostnames: [],
      contentType: "text/html",
      checkedAt: "2026-08-14T00:00:00.000Z",
      bodyInspected: true,
    },
    { authorityValidated: true },
  );

  assert.equal(
    evidence?.observedVenue,
    "International Symposium on Computer Architecture",
  );
});

test("publisher-prefixed proceedings editions match the canonical venue plan", () => {
  const payload = JSON.parse(
    result([
      paper({
        title:
          "Back to the Future: Leveraging Belady's Algorithm for Improved Cache Replacement",
        authors: ["Akanksha Jain", "Calvin Lin"],
        year: 2016,
        venueName: "International Symposium on Computer Architecture",
        venueAcronym: "ISCA",
        leadingVenueAssessment: {
          venueName: "International Symposium on Computer Architecture",
          venueAcronym: "ISCA",
          fields: ["computer architecture"],
          judgment: "leading",
          confidence: "high",
          basis: "A principal archival computer architecture venue.",
        },
        publicationEvidence: [
          {
            type: "publisher_proceedings",
            sourceName: "IEEE Xplore",
            url: "https://ieeexplore.ieee.org/document/7551382",
            observedTitle:
              "Back to the Future: Leveraging Belady's Algorithm for Improved Cache Replacement",
            observedVenue:
              "Proceedings of the 2016 ACM/IEEE 43rd Annual International Symposium on Computer Architecture",
            observedTrack: "Main conference",
            observedDecision: "Published",
            checkedAt: "2026-08-14T00:00:00.000Z",
            supports: ["identity", "published", "main_track"],
          },
        ],
      }),
    ]),
  );
  payload.plan.venues = [
    {
      venueName: "International Symposium on Computer Architecture",
      venueAcronym: "ISCA",
      fields: ["computer architecture"],
      judgment: "leading",
      confidence: "high",
      basis: "A principal archival computer architecture venue.",
    },
  ];

  assert.equal(
    parseDiscoveryResult(JSON.stringify(payload)).verifiedMain.length,
    1,
  );
});

test("non-leading peer-reviewed venues need not expand the bounded leading-venue plan", () => {
  const payload = JSON.parse(result([]));
  payload.plan.venues = [
    {
      venueName: "Example Conference",
      fields: ["example field"],
      judgment: "leading",
      confidence: "high",
      basis: "Field-specific archival venue assessment.",
    },
  ];
  payload.otherPeerReviewed = [
    paper({
      venueName: "IEICE Transactions on Information and Systems",
      venueAcronym: "IEICE Trans. Inf. Syst.",
      publicationClass: "verified_journal",
      publicationEvidence: [
        {
          type: "publisher_proceedings",
          sourceName: "J-STAGE",
          url: "https://www.jstage.jst.go.jp/article/example",
          observedTitle: "Verified Paper",
          observedVenue: "IEICE Transactions on Information and Systems",
          observedTrack: "journal article",
          observedDecision: "published",
          checkedAt: "2026-08-14T00:00:00.000Z",
          supports: ["identity", "published"],
        },
      ],
      leadingVenueAssessment: {
        venueName: "IEICE Transactions on Information and Systems",
        venueAcronym: "IEICE Trans. Inf. Syst.",
        fields: ["computer systems"],
        judgment: "not_leading",
        confidence: "medium",
        basis: "Peer-reviewed journal outside the field's leading venue set.",
      },
    }),
  ];

  const parsed = parseDiscoveryResult(JSON.stringify(payload));
  assert.equal(parsed.verifiedMain.length, 0);
  assert.equal(parsed.otherPeerReviewed.length, 1);
  assert.equal(
    parsed.otherPeerReviewed[0].leadingVenueAssessment.judgment,
    "not_leading",
  );
});

test("Unicode titles keep distinct identity keys", () => {
  assert.equal(
    areLikelySamePaper(
      { title: "神经网络方法", authors: ["张三"], year: 2025, providerIDs: {} },
      { title: "量子体系结构", authors: ["李四"], year: 2025, providerIDs: {} },
    ),
    false,
  );
  assert.equal(
    areLikelySamePaper(
      {
        title: "신경망 학습",
        authors: ["김 연구"],
        year: 2025,
        providerIDs: {},
      },
      {
        title: "신경망 학습",
        authors: ["김 연구"],
        year: 2025,
        providerIDs: {},
      },
    ),
    true,
  );
});

test("discovery note and collection metadata preserve scope, lanes, and evidence", () => {
  const discovery = parseDiscoveryResult(result([paper()]));
  const note = buildDiscoveryNoteMarkdown({
    paperTitle: "Current paper",
    concern: "Does this idea already exist?",
    discovery,
  });
  assert.match(note, /Does this idea already exist/);
  assert.match(note, /Verified main-conference papers/);
  assert.match(note, /Other peer-reviewed work/);
  assert.match(note, /Frontier \/ novelty radar/);
  assert.match(note, /https:\/\/proceedings\.example\.org\/paper-1/);

  const recommendation =
    discoveryResultToRecommendationGroups(discovery)[0].papers[0];
  const extra = buildDiscoveryEvidenceExtra(recommendation);
  assert.match(extra, /Publication class: verified_main/);
  assert.match(extra, /Evidence \(official_proceedings/);
  assert.match(extra, /Search concern: Concern/);
});

test("pre-gate discovery note and collection metadata redact review insight", () => {
  const discovery = parseDiscoveryResult(result([paper()]));
  discovery.verifiedMain[0].reviewURL =
    "https://openreview.net/forum?id=private-until-gate";
  discovery.verifiedMain[0].reviewInsight = {
    sourceURLs: ["https://openreview.net/forum?id=private-until-gate"],
    valuedStrengths: ["Strength must remain hidden"],
    concerns: ["Concern must remain hidden"],
    reviewerPriorities: [],
    disagreements: [],
    limitations: [],
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
  const note = buildDiscoveryNoteMarkdown({
    paperTitle: "Current paper",
    discovery,
    includeReviewInsights: false,
  });
  assert.doesNotMatch(note, /Strength must remain hidden/);
  assert.doesNotMatch(note, /private-until-gate/);
  const recommendation =
    discoveryResultToRecommendationGroups(discovery)[0].papers[0];
  const extra = buildDiscoveryEvidenceExtra(recommendation, {
    includeReviewURL: false,
  });
  assert.doesNotMatch(extra, /private-until-gate/);
});

test("public review insight requires a source URL and preserves disagreement", () => {
  const insight = parsePublicReviewInsight(
    JSON.stringify({
      sourceURLs: ["https://openreview.net/forum?id=example"],
      valuedStrengths: ["Clear evaluation"],
      concerns: ["Limited scale"],
      reviewerPriorities: ["Stronger baselines"],
      disagreements: ["Reviewers differed on novelty"],
      limitations: ["One review was unavailable"],
      generatedAt: "2026-08-12T00:00:00.000Z",
    }),
    "https://openreview.net/forum?id=example",
  );
  assert.deepEqual(insight.disagreements, ["Reviewers differed on novelty"]);
  assert.throws(
    () =>
      parsePublicReviewInsight(
        '{"concerns":["No source"]}',
        "https://openreview.net/forum?id=example",
      ),
    /source-linked review insight required/i,
  );
});

test("public review insight binds the verified forum and omits oversized raw text", () => {
  assert.throws(
    () =>
      parsePublicReviewInsight(
        JSON.stringify({
          sourceURLs: ["https://attacker.example/not-a-review"],
          concerns: ["Injected"],
          limitations: [],
        }),
        "https://openreview.net/forum?id=expected",
      ),
    /source-linked review insight required/i,
  );
  const raw = "PRIVATE_OR_FULL_REVIEW ".repeat(5_000);
  const bounded = parsePublicReviewInsight(
    JSON.stringify({
      sourceURLs: ["https://openreview.net/forum?id=expected"],
      valuedStrengths: [],
      concerns: [raw],
      reviewerPriorities: [],
      disagreements: [],
      limitations: [],
    }),
    "https://openreview.net/forum?id=expected",
  );
  assert.equal(bounded.concerns.includes(raw), false);
  assert.match(bounded.limitations.join(" "), /oversized review text/i);
});

test("discovery prompt is zero-config, open-world, and lane explicit", () => {
  const prompt = buildDiscoveryQuestion({
    item: {
      getField: (field: string) => (field === "title" ? "Current Paper" : ""),
      getCreators: () => [],
    },
    concern: { origin: "user_text", text: "Has this idea been studied?" },
  });
  assert.match(prompt, /must not be asked to choose fields or venues/i);
  assert.match(prompt, /open-world/i);
  assert.match(prompt, /official proceedings/i);
  assert.match(prompt, /verifiedMain/);
  assert.match(prompt, /otherPeerReviewed/);
  assert.match(prompt, /noveltyRadar/);
});

test("search intent inference distinguishes novelty checks", () => {
  assert.equal(
    inferDiscoveryIntent("Has this idea already been done?"),
    "novelty_check",
  );
  assert.equal(inferDiscoveryIntent(""), "prior_work");
});

test("cross-field publication fixtures fail closed for non-main classes", () => {
  const fixtures = JSON.parse(
    readFileSync(
      join(__dirname, "fixtures", "discovery", "publication-cases.json"),
      "utf8",
    ),
  ) as {
    positive: Array<{
      title: string;
      venue: string;
      field: string;
      track: string;
      url: string;
    }>;
    negative: Array<{
      title: string;
      class: string;
      observedTitle?: string;
    }>;
  };
  const positives = fixtures.positive.map((entry, index) =>
    paper({
      candidateID: `positive-${index}`,
      title: entry.title,
      venueName: entry.venue,
      track: entry.track,
      publicationEvidence: [
        {
          type: "official_proceedings",
          sourceName: "Official proceedings",
          url: entry.url,
          observedTitle: entry.title,
          observedVenue: entry.venue,
          observedTrack: entry.track,
          checkedAt: "2026-08-12T00:00:00.000Z",
          supports: ["identity", "published", "main_track"],
        },
      ],
      leadingVenueAssessment: {
        venueName: entry.venue,
        fields: [entry.field],
        judgment: "leading",
        confidence: "high",
        basis: `Reviewed fixture for ${entry.field}`,
      },
    }),
  );
  const negatives = fixtures.negative.map((entry, index) =>
    paper({
      candidateID: `negative-${index}`,
      title: entry.title,
      publicationClass: entry.class,
      publicationEvidence: entry.observedTitle
        ? [
            {
              type: "official_proceedings",
              sourceName: "Official proceedings",
              url: "https://proceedings.example.org/false-title",
              observedTitle: entry.observedTitle,
              observedTrack: "Main Conference",
              supports: ["identity", "published", "main_track"],
            },
          ]
        : [],
    }),
  );
  const parsed = parseDiscoveryResult(result([...positives, ...negatives]));
  assert.equal(parsed.verifiedMain.length, positives.length);
  assert.equal(
    parsed.verifiedMain.some((entry) =>
      fixtures.negative.some((negative) => negative.title === entry.title),
    ),
    false,
  );
  assert.ok(
    parsed.verifiedMain.some(
      (entry) => entry.venueName === "New Archival Venue",
    ),
  );
});

test("versioned raw agent capture is scored against independent cross-field gold", () => {
  const evaluation = JSON.parse(
    readFileSync(
      join(__dirname, "fixtures", "discovery", "evaluation-v3.json"),
      "utf8",
    ),
  ) as {
    version: number;
    capture: {
      model: string;
      webSearch: boolean;
      sessionID: string;
      inputDisclosure: string;
      rawOutput: string;
    };
    goldCases: Array<{
      id: string;
      concern: string;
      primaryFieldTerms: string[];
      adjacentFieldTerms: string[];
      venueUniverse: Array<{
        venueName: string;
        aliases: string[];
        expected: "leading" | "not_leading";
      }>;
      mainPaper: {
        verifiedTitle: string;
        verifiedClass: string;
        verifiedVenueAcronym: string;
        officialEvidenceURLs: string[];
      };
      temptingNegative: { verifiedClass: string };
      acceptedNoveltyRelationships: string[];
    }>;
  };
  const capture = JSON.parse(evaluation.capture.rawOutput) as {
    cases: Array<{
      id: string;
      primaryField: string;
      adjacentFields: string[];
      venues: Array<{
        venueName: string;
        judgment: string;
        confidence: string;
      }>;
      mainPaper: {
        title: string;
        venueAcronym: string;
        publicationClass: string;
        officialEvidenceURL: string;
      };
      temptingNegative: { title: string; publicationClass: string };
      noveltyRelationship: string;
    }>;
  };
  assert.equal(evaluation.version, 3);
  assert.equal(evaluation.capture.webSearch, true);
  assert.match(evaluation.capture.sessionID, /^[0-9a-f-]{20,}$/);
  assert.match(evaluation.capture.inputDisclosure, /no venue expectations/i);
  assert.equal(capture.cases.length, 3);
  assert.equal(evaluation.goldCases.length, 3);
  assert.deepEqual(
    capture.cases.map((entry) => entry.id),
    evaluation.goldCases.map((entry) => entry.id),
  );

  const normalizeTerm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const predictsLeading = (venue: { judgment: string; confidence: string }) =>
    venue.judgment === "leading" ||
    (venue.judgment === "plausibly_leading" && venue.confidence === "high");
  const scoreVenueAgreement = (leadingByCase: Map<string, Set<string>>) => {
    let agreements = 0;
    let universeSize = 0;
    for (const gold of evaluation.goldCases) {
      const predicted = leadingByCase.get(gold.id) || new Set<string>();
      for (const venue of gold.venueUniverse) {
        universeSize += 1;
        const predictedLeading = venue.aliases.some((alias) =>
          predicted.has(normalizeTerm(alias)),
        );
        if (predictedLeading === (venue.expected === "leading")) {
          agreements += 1;
        }
      }
    }
    return agreements / universeSize;
  };

  const observedLeading = new Map(
    capture.cases.map((entry) => [
      entry.id,
      new Set(
        entry.venues
          .filter(predictsLeading)
          .map((venue) => normalizeTerm(venue.venueName)),
      ),
    ]),
  );
  const venueAgreement = scoreVenueAgreement(observedLeading);
  assert.ok(
    venueAgreement >= 0.9,
    `reviewed leading-venue agreement ${venueAgreement} must be >= 0.9`,
  );
  // The pinned capture under-rates ASPLOS, so the scorer must record that
  // false negative instead of quietly reaching a perfect score.
  assert.equal(
    observedLeading.get("architecture-memory")?.has("asplos"),
    false,
  );
  assert.ok(Math.abs(venueAgreement - 14 / 15) < 1e-9);
  const allLeading = new Map(
    evaluation.goldCases.map((gold) => [
      gold.id,
      new Set(
        gold.venueUniverse.flatMap((venue) =>
          venue.aliases.map((alias) => normalizeTerm(alias)),
        ),
      ),
    ]),
  );
  assert.ok(
    scoreVenueAgreement(allLeading) < 0.9,
    "predicting every reviewed venue as leading must fail the agreement gate",
  );

  for (const [index, gold] of evaluation.goldCases.entries()) {
    const prediction = capture.cases[index];
    const primaryField = normalizeTerm(prediction.primaryField);
    assert.ok(
      gold.primaryFieldTerms.some((term) =>
        primaryField.includes(normalizeTerm(term)),
      ),
      `${gold.id}: primary field "${prediction.primaryField}" missed the reviewed terms`,
    );
    const adjacentFields = prediction.adjacentFields.map(normalizeTerm);
    const adjacentOverlap = gold.adjacentFieldTerms.filter((term) =>
      adjacentFields.some(
        (field) =>
          field.includes(normalizeTerm(term)) ||
          normalizeTerm(term).includes(field),
      ),
    );
    assert.ok(
      adjacentFields.length >= 3 && adjacentOverlap.length >= 2,
      `${gold.id}: adjacent fields missed the reviewed terms`,
    );
    const mainPaper = prediction.mainPaper;
    assert.equal(
      normalizeTerm(mainPaper.title),
      normalizeTerm(gold.mainPaper.verifiedTitle),
      `${gold.id}: main paper title diverged from the verified record`,
    );
    assert.equal(mainPaper.publicationClass, gold.mainPaper.verifiedClass);
    assert.equal(
      normalizeTerm(mainPaper.venueAcronym),
      normalizeTerm(gold.mainPaper.verifiedVenueAcronym),
    );
    assert.ok(
      gold.mainPaper.officialEvidenceURLs.includes(
        mainPaper.officialEvidenceURL,
      ),
      `${gold.id}: evidence URL ${mainPaper.officialEvidenceURL} is not a verified official record`,
    );
    assert.ok(
      gold.venueUniverse.some(
        (venue) =>
          venue.expected === "leading" &&
          venue.aliases.includes(normalizeTerm(mainPaper.venueAcronym)),
      ),
      `${gold.id}: main paper venue is not a reviewed leading venue`,
    );
    assert.notEqual(
      prediction.temptingNegative.publicationClass,
      "verified_main",
      `${gold.id}: a tempting negative must never claim the primary lane`,
    );
    assert.ok(
      gold.acceptedNoveltyRelationships.includes(
        prediction.noveltyRelationship,
      ),
      `${gold.id}: novelty relationship ${prediction.noveltyRelationship} not in the reviewed set`,
    );
  }

  // Negative classes are scored directly against independently verified gold.
  // Two gold labels contradict the raw prediction (KOSMOS-1 is a NeurIPS 2023
  // main-conference paper and "Together or Alone" is a PoPETs journal
  // publication), so the pinned match count proves the gold labels were not
  // copied from the capture.
  const negativeClassMatches = evaluation.goldCases.filter(
    (gold, index) =>
      capture.cases[index].temptingNegative.publicationClass ===
      gold.temptingNegative.verifiedClass,
  ).length;
  assert.equal(negativeClassMatches, 1);
});
