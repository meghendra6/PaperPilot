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
import { areLikelySamePaper } from "../src/modules/discovery/normalize";
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
  assert.equal(parsed.verifiedMain.length, 2);
  assert.equal(
    new Set(parsed.verifiedMain.map((entry) => entry.candidateID)).size,
    2,
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
    fetch: (async () =>
      new Response(
        "<title>Example Conference Main Conference</title><main>accepted — Verified Paper — A. Author — 2026 — reviews</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });
  assert.equal(matched.verifiedMain.length, 1);

  await assert.rejects(
    verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response("<title>A different work</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
    }),
    /did not include any usable papers/,
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
    fetch: (async () =>
      new Response(
        "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference — Main Conference — accepted — reviews and meta-review</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
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
  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: (async (input) => {
      if (String(input) === claimedReviewURL) {
        return new Response(null, {
          status: 302,
          headers: { location: actualReviewURL },
        });
      }
      return new Response(
        "<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference — Main Conference — accepted — reviews and meta-review</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch,
  });
  assert.equal(verified.verifiedMain[0].reviewURL, actualReviewURL);
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
    const verified = await verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          `<title>Verified Paper</title><main>Verified Paper — A. Author — 2026 — Example Conference — accepted ${label}</main>`,
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
    });
    assert.equal(verified.verifiedMain.length, 1, url);

    const workshop = await verifyDiscoveryEvidenceLive({
      discovery,
      fetch: (async () =>
        new Response(
          `<title>Verified Paper</title><main>Workshop poster — Example Conference — accepted ${label} — Verified Paper — A. Author — 2026</main>`,
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
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
      join(__dirname, "fixtures", "discovery", "evaluation-v2.json"),
      "utf8",
    ),
  ) as {
    version: number;
    capture: {
      provider: string;
      model: string;
      sessionID: string;
      capturedAt: string;
      rawOutput: string;
    };
    goldCases: Array<{
      id: string;
      concern: string;
      primaryFieldTerms: string[];
      adjacentFieldTerms: string[];
      acceptedLeadingVenues: string[];
      mainTitle: string;
      mainVenue: string;
      negativeTitle: string;
      negativeClass: string;
    }>;
  };
  const capture = JSON.parse(evaluation.capture.rawOutput) as {
    cases: Array<{
      id: string;
      primaryField: string;
      adjacentFields: string[];
      venues: Array<{
        venueName: string;
        fields: string[];
        judgment: string;
        confidence: string;
        basis: string;
      }>;
    }>;
  };
  assert.equal(evaluation.version, 2);
  assert.match(evaluation.capture.sessionID, /^[0-9a-f-]{20,}$/);
  assert.equal(capture.cases.length, 3);
  assert.equal(evaluation.goldCases.length, 3);

  const parsedCases = capture.cases.map((prediction, caseIndex) => {
    const gold = evaluation.goldCases.find(
      (entry) => entry.id === prediction.id,
    );
    assert.ok(gold, `missing independent gold for ${prediction.id}`);
    const queries = ["problem", "method", "evaluation"].map((family) => ({
      query: `${gold.concern} ${family}`,
      family,
      rationale: `${family} coverage`,
    }));
    const main = paper({
      candidateID: `evaluation-main-${caseIndex}`,
      title: gold.mainTitle,
      venueName: gold.mainVenue,
      urls: [`https://proceedings.example.org/evaluation-${caseIndex}`],
      publicationEvidence: [
        {
          type: "official_proceedings",
          sourceName: "Reviewer-confirmed official evidence",
          url: `https://proceedings.example.org/evaluation-${caseIndex}`,
          observedTitle: gold.mainTitle,
          observedVenue: gold.mainVenue,
          observedTrack: "Main Conference",
          supports: ["identity", "published", "main_track"],
        },
      ],
      leadingVenueAssessment: prediction.venues.find(
        (venue) => venue.venueName === gold.mainVenue,
      ),
      noveltyRelationship: "same_problem_different_method",
    });
    const negative = paper({
      candidateID: `evaluation-negative-${caseIndex}`,
      title: gold.negativeTitle,
      urls: ["https://arxiv.org/abs/2601.00001"],
      providerIDs: { arxiv: `2601.${caseIndex}` },
      publicationClass: gold.negativeClass,
      publicationEvidence:
        gold.negativeClass === "preprint_only"
          ? [
              {
                type: "scholarly_index",
                sourceName: "Live scholarly provider: arxiv",
                url: "https://arxiv.org/abs/2601.00001",
                observedTitle: gold.negativeTitle,
                supports: ["identity"],
              },
            ]
          : [],
      venueName: prediction.venues[0].venueName,
      leadingVenueAssessment: prediction.venues[0],
    });
    return {
      gold,
      prediction,
      parsed: parseDiscoveryResult(
        JSON.stringify({
          schemaVersion: 1,
          plan: {
            concernSummary: gold.concern,
            primaryField: prediction.primaryField,
            adjacentFields: prediction.adjacentFields,
            venues: prediction.venues,
            queries,
            scopeSummary:
              "Raw captured prediction scored against independent reviewer gold.",
          },
          verifiedMain: [main],
          otherPeerReviewed: [],
          noveltyRadar: [negative],
          excluded: [],
          limitations: [],
          completedAt: evaluation.capture.capturedAt,
        }),
      ),
    };
  });

  assert.ok(
    parsedCases.every(
      ({ gold, prediction, parsed }) =>
        parsed.plan.primaryField.length > 3 &&
        parsed.plan.adjacentFields.length >= 3 &&
        parsed.verifiedMain.length === 1 &&
        parsed.verifiedMain[0].title === gold.mainTitle &&
        parsed.verifiedMain[0].publicationEvidence.some((evidence) =>
          evidence.supports.includes("main_track"),
        ) &&
        !parsed.verifiedMain.some(
          (candidate) => candidate.title === gold.negativeTitle,
        ),
    ),
  );
  const expected = evaluation.goldCases.flatMap(
    (entry) => entry.acceptedLeadingVenues,
  );
  const observedByCase = parsedCases.map(({ gold, parsed }) => ({
    expected: gold.acceptedLeadingVenues,
    observed: parsed.plan.venues
      .filter(
        (venue) =>
          venue.judgment === "leading" ||
          (venue.judgment === "plausibly_leading" &&
            venue.confidence === "high"),
      )
      .map((venue) => venue.venueName),
  }));
  const matches = observedByCase.reduce(
    (count, result) =>
      count +
      result.expected.filter((venue) => result.observed.includes(venue)).length,
    0,
  );
  const agreement = matches / expected.length;
  assert.ok(
    agreement >= 0.9,
    `reviewed leading-venue agreement ${agreement} must be >= 0.9`,
  );
});
