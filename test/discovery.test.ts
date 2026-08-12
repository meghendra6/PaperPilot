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
import { verifyDiscoveryEvidenceLive } from "../src/modules/discovery/workflow";
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

test("discovery deduplicates provider IDs and normalized title-author matches", () => {
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
    true,
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
          observedTrack: "Main Conference",
          checkedAt: "2026-08-12T00:00:00.000Z",
          supports: ["identity", "published", "main_track"],
        },
      ],
    }),
  );
  const parsed = parseDiscoveryResult(result(entries));
  assert.equal(parsed.verifiedMain.length, 12);
  assert.equal(parsed.verifiedMain[0].candidateID, "rank-12");
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
  const discovery = parseDiscoveryResult(
    result([
      paper(),
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
        "<title>Verified Paper</title><main>Verified Paper — Example Conference — Main Conference — accepted</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });
  assert.equal(matched.verifiedMain.length, 1);

  const mismatched = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: (async () =>
      new Response("<title>A different work</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch,
  });
  assert.equal(mismatched.verifiedMain.length, 0);
  assert.equal(mismatched.otherPeerReviewed.length, 1);
  assert.match(
    mismatched.limitations.join(" "),
    /did not independently verify/,
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
  const officialProgramURL = "https://conference.example.org/program";
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

  const verified = await verifyDiscoveryEvidenceLive({
    discovery,
    fetch: (async () =>
      new Response(
        "<title>Example Conference program</title><main>Session 2A — Verified Paper</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch,
  });

  assert.equal(verified.verifiedMain.length, 1);
  assert.equal(
    verified.verifiedMain[0].publicationEvidence[0].observedDecision,
    "Listed in official program",
  );
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
        "<title>Verified Paper</title><main>Verified Paper — Example Conference — Main Conference — accepted — reviews and meta-review</main>",
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
        "<title>Verified Paper</title><main>Verified Paper — Example Conference — Main Conference — accepted — reviews and meta-review</main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch,
  });
  assert.equal(verified.verifiedMain[0].reviewURL, actualReviewURL);
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
  );
  assert.deepEqual(insight.disagreements, ["Reviewers differed on novelty"]);
  assert.throws(
    () => parsePublicReviewInsight('{"concerns":["No source"]}'),
    /source-linked review insight required/i,
  );
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

test("versioned captured-agent evaluation scores product output across AI, architecture, and HCI", () => {
  const evaluation = JSON.parse(
    readFileSync(
      join(__dirname, "fixtures", "discovery", "evaluation-v1.json"),
      "utf8",
    ),
  ) as {
    version: number;
    cases: Array<{
      concern: string;
      expectedPrimaryField: string;
      expectedAdjacentFields: string[];
      reviewedLeadingVenues: string[];
      capturedResult: {
        plan: {
          primaryField: string;
          adjacentFields: string[];
          venues: Array<{
            venueName: string;
            fields: string[];
            judgment: string;
            confidence: string;
            basis: string;
          }>;
        };
        mainPaper: {
          title: string;
          venue: string;
          url: string;
          noveltyRelationship: string;
        };
        negative: { title: string; publicationClass: string };
      };
    }>;
  };
  assert.equal(evaluation.version, 1);
  assert.equal(evaluation.cases.length, 3);
  const parsedCases = evaluation.cases.map((entry, caseIndex) => {
    const queries = ["problem", "method", "evaluation"].map((family) => ({
      query: `${entry.concern} ${family}`,
      family,
      rationale: `${family} coverage`,
    }));
    const main = paper({
      candidateID: `evaluation-main-${caseIndex}`,
      title: entry.capturedResult.mainPaper.title,
      venueName: entry.capturedResult.mainPaper.venue,
      urls: [entry.capturedResult.mainPaper.url],
      publicationEvidence: [
        {
          type: "official_proceedings",
          sourceName: "Reviewed official proceedings capture",
          url: entry.capturedResult.mainPaper.url,
          observedTitle: entry.capturedResult.mainPaper.title,
          observedVenue: entry.capturedResult.mainPaper.venue,
          observedTrack: "Main Conference",
          supports: ["identity", "published", "main_track"],
        },
      ],
      leadingVenueAssessment: entry.capturedResult.plan.venues.find(
        (venue) => venue.venueName === entry.capturedResult.mainPaper.venue,
      ),
      noveltyRelationship: entry.capturedResult.mainPaper.noveltyRelationship,
    });
    const negative = paper({
      candidateID: `evaluation-negative-${caseIndex}`,
      title: entry.capturedResult.negative.title,
      urls: ["https://arxiv.org/abs/2601.00001"],
      publicationClass: entry.capturedResult.negative.publicationClass,
      publicationEvidence: [],
      venueName: entry.capturedResult.plan.venues[0].venueName,
      leadingVenueAssessment: entry.capturedResult.plan.venues[0],
    });
    return {
      entry,
      parsed: parseDiscoveryResult(
        JSON.stringify({
          schemaVersion: 1,
          plan: {
            concernSummary: entry.concern,
            ...entry.capturedResult.plan,
            queries,
            scopeSummary: "Captured agent output reviewed against gold labels.",
          },
          verifiedMain: [main],
          otherPeerReviewed: [],
          noveltyRadar: [negative],
          excluded: [],
          limitations: [],
          completedAt: "2026-08-13T00:00:00.000Z",
        }),
      ),
    };
  });
  assert.ok(
    parsedCases.every(
      ({ entry, parsed }) =>
        parsed.plan.primaryField === entry.expectedPrimaryField &&
        entry.expectedAdjacentFields.every((field) =>
          parsed.plan.adjacentFields.includes(field),
        ) &&
        parsed.verifiedMain.length === 1 &&
        parsed.verifiedMain[0].publicationEvidence.some((evidence) =>
          evidence.supports.includes("main_track"),
        ) &&
        !parsed.verifiedMain.some(
          (candidate) =>
            candidate.title === entry.capturedResult.negative.title,
        ) &&
        parsed.verifiedMain[0].noveltyRelationship ===
          entry.capturedResult.mainPaper.noveltyRelationship,
    ),
  );
  const expected = evaluation.cases.flatMap(
    (entry) => entry.reviewedLeadingVenues,
  );
  const observedByCase = parsedCases.map(({ entry, parsed }) => ({
    expected: entry.reviewedLeadingVenues,
    observed: parsed.plan.venues
      .filter((venue) => venue.judgment === "leading")
      .map((venue) => venue.venueName),
  }));
  assert.ok(
    observedByCase.every(({ observed, expected }) =>
      observed.every((venue) => expected.includes(venue)),
    ),
    "captured results must not introduce unreviewed leading venues",
  );
  const matches = observedByCase.reduce(
    (count, result) =>
      count +
      result.expected.filter((venue) => result.observed.includes(venue)).length,
    0,
  );
  const agreement = matches / expected.length;
  assert.ok(agreement >= 0.9, `venue agreement ${agreement} must be >= 0.9`);
});
