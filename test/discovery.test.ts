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
  return JSON.stringify({
    schemaVersion: 1,
    plan: {
      concernSummary: "Concern",
      primaryField: "Example field",
      adjacentFields: ["Adjacent field"],
      venues: [],
      queries: [
        { query: "example query", family: "problem", rationale: "direct" },
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
        "<title>Verified Paper</title><main>Verified Paper — Main Conference</main>",
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
  assert.match(mismatched.limitations.join(" "), /did not match/);
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

test("versioned agent evaluation set spans AI, architecture, and HCI", () => {
  const evaluation = JSON.parse(
    readFileSync(
      join(__dirname, "fixtures", "discovery", "evaluation-v1.json"),
      "utf8",
    ),
  ) as {
    version: number;
    cases: Array<{
      primaryField: string;
      adjacentFields: string[];
      leadingVenues: string[];
      reviewedAgentVenues: string[];
      knownRelevantMainPapers: string[];
      expectedNoveltyRelationship: string;
    }>;
  };
  assert.equal(evaluation.version, 1);
  assert.equal(evaluation.cases.length, 3);
  assert.ok(
    evaluation.cases.every(
      (entry) =>
        entry.primaryField &&
        entry.adjacentFields.length &&
        entry.leadingVenues.length >= 2 &&
        entry.knownRelevantMainPapers.length > 0 &&
        entry.expectedNoveltyRelationship,
    ),
  );
  const expected = evaluation.cases.flatMap((entry) => entry.leadingVenues);
  const observed = evaluation.cases.flatMap(
    (entry) => entry.reviewedAgentVenues,
  );
  const agreement =
    expected.filter((venue) => observed.includes(venue)).length /
    expected.length;
  assert.ok(agreement >= 0.9, `venue agreement ${agreement} must be >= 0.9`);
});
