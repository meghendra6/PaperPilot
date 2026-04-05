import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildCompareSelection,
  buildCompareSelectionFromRecommendations,
  buildPaperCompareCardFromResponse,
  buildPaperCompareRequestFromRecommendations,
  buildPaperCompareCard,
  buildPaperCompareQuestion,
  getPaperCompareButtonState,
  getPaperCompareEntryState,
  getPaperCompareMetrics,
  getPaperCompareWorkflowState,
  parsePaperCompareResponse,
  selectCompareCandidates,
} from "../src/modules/paperCompare";

test("buildCompareSelection bounds compare papers and records dropped titles", () => {
  const selection = buildCompareSelection({
    currentPaper: { title: "Current Paper" },
    comparePapers: [
      { title: "Paper B" },
      { title: "Current Paper" },
      { title: "Paper C" },
      { title: "Paper D" },
      { title: "Paper E" },
    ],
    maxComparePapers: 3,
  });

  assert.equal(selection.currentPaper.title, "Current Paper");
  assert.deepEqual(
    selection.comparePapers.map((paper) => paper.title),
    ["Paper B", "Paper C", "Paper D"],
  );
  assert.deepEqual(selection.droppedTitles, ["Current Paper", "Paper E"]);
});

test("buildCompareSelection normalizes whitespace-heavy metadata", () => {
  const selection = buildCompareSelection({
    currentPaper: {
      title: "  Current   Paper  ",
      authors: [" Ada  Lovelace "],
      year: " 2026 ",
      abstract: "  Current abstract.  ",
      reason: "  Anchor paper  ",
    },
    comparePapers: [
      {
        title: "  Paper B  ",
        authors: [" Grace   Hopper "],
        year: " 2025 ",
        abstract: "  Compare abstract. ",
        reason: " Recommended   follow-up ",
      },
    ],
  });

  assert.deepEqual(selection, {
    currentPaper: {
      title: "Current Paper",
      authors: ["Ada Lovelace"],
      year: "2026",
      abstract: "Current abstract.",
      reason: "Anchor paper",
    },
    comparePapers: [
      {
        title: "Paper B",
        authors: ["Grace Hopper"],
        year: "2025",
        abstract: "Compare abstract.",
        reason: "Recommended follow-up",
      },
    ],
    droppedTitles: [],
  });
});

test("buildCompareSelection rejects an empty bounded compare set after normalization", () => {
  assert.throws(
    () =>
      buildCompareSelection({
        currentPaper: { title: "Current Paper" },
        comparePapers: [{ title: "   " }, { title: "Current Paper" }],
      }),
    /At least one comparison paper is required/i,
  );
});

test("selectCompareCandidates bounds and deduplicates recommended papers", () => {
  const selected = selectCompareCandidates([
    {
      papers: [
        { title: "Paper A", authors: [], relevanceScore: 0.9, doi: "10.1/a" },
        { title: "Paper A", authors: [], relevanceScore: 0.8, doi: "10.1/a" },
      ],
    },
    {
      papers: [
        { title: "Paper B", authors: [], relevanceScore: 0.7 },
        { title: "Paper C", authors: [], relevanceScore: 0.6 },
        { title: "Paper D", authors: [], relevanceScore: 0.5 },
      ],
    },
  ]);

  assert.deepEqual(
    selected.map((paper) => paper.title),
    ["Paper A", "Paper B", "Paper C"],
  );
});

test("buildCompareSelectionFromRecommendations converts related-paper groups into bounded compare inputs", () => {
  const selection = buildCompareSelectionFromRecommendations({
    currentPaper: {
      title: "Current Paper",
      authors: ["Ada Lovelace"],
      year: 2026,
      abstract: "Current abstract.",
    },
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Paper B",
            authors: ["Grace Hopper"],
            year: 2025,
            abstract: "Compare abstract.",
            relevanceScore: 0.9,
            reason: "Recommended follow-up",
          },
          {
            title: "Paper C",
            authors: ["Barbara Liskov"],
            year: 2024,
            relevanceScore: 0.8,
          },
        ],
      },
    ],
    maxComparePapers: 1,
  });

  assert.equal(selection.currentPaper.title, "Current Paper");
  assert.deepEqual(selection.comparePapers, [
    {
      title: "Paper B",
      authors: ["Grace Hopper"],
      year: 2025,
      abstract: "Compare abstract.",
      reason: "Recommended follow-up",
    },
  ]);
  assert.deepEqual(selection.droppedTitles, ["Paper C"]);
});

test("buildPaperCompareRequestFromRecommendations packages a compare prompt from bounded recommendations", () => {
  const request = buildPaperCompareRequestFromRecommendations({
    currentPaper: {
      title: "Current Paper",
      authors: ["Ada Lovelace"],
      year: 2026,
    },
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Paper B",
            authors: ["Grace Hopper"],
            year: 2025,
            relevanceScore: 0.9,
            reason: "Recommended follow-up",
          },
          {
            title: "Paper C",
            authors: ["Barbara Liskov"],
            year: 2024,
            relevanceScore: 0.8,
          },
        ],
      },
    ],
    maxComparePapers: 2,
  });

  assert.equal(request.label, "Compare papers");
  assert.equal(request.selection.currentPaper.title, "Current Paper");
  assert.deepEqual(
    request.selection.comparePapers.map((paper) => paper.title),
    ["Paper B", "Paper C"],
  );
  assert.match(request.prompt, /Return ONLY one strict JSON object/i);
  assert.match(request.prompt, /Comparison set:/);
  assert.match(request.prompt, /Title: Paper B/);
  assert.match(
    request.prompt,
    /do not invent extra papers or missing details/i,
  );
});

test("getPaperCompareEntryState disables compare when current paper metadata is missing", () => {
  assert.deepEqual(
    getPaperCompareEntryState({
      currentPaperTitle: "   ",
      groups: [],
    }),
    {
      enabled: false,
      reason: "Current paper metadata is unavailable.",
      candidateCount: 0,
    },
  );
});

test("getPaperCompareEntryState disables compare when there are no recommended peers", () => {
  assert.deepEqual(
    getPaperCompareEntryState({
      currentPaperTitle: "Current Paper",
      groups: [],
    }),
    {
      enabled: false,
      reason: "Need at least one recommended peer before compare can run.",
      candidateCount: 0,
    },
  );
});

test("getPaperCompareEntryState reports a bounded compare-ready state", () => {
  const state = getPaperCompareEntryState({
    currentPaperTitle: "Current Paper",
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Paper B",
            authors: ["Grace Hopper"],
            year: 2025,
            relevanceScore: 0.9,
          },
          {
            title: "Paper C",
            authors: ["Barbara Liskov"],
            year: 2024,
            relevanceScore: 0.8,
          },
        ],
      },
    ],
    maxComparePapers: 1,
  });

  assert.deepEqual(state, {
    enabled: true,
    reason: "Compare will use the current paper plus 1 peer.",
    candidateCount: 1,
  });
});

test("getPaperCompareButtonState exposes a compact ready label", () => {
  const state = getPaperCompareButtonState({
    currentPaperTitle: "Current Paper",
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Peer Paper",
            authors: ["Ada Lovelace"],
            relevanceScore: 0.9,
          },
        ],
      },
    ],
  });

  assert.deepEqual(state, {
    enabled: true,
    reason: "Compare will use the current paper plus 1 peer.",
    candidateCount: 1,
    label: "Compare (1)",
    title: "Compare will use the current paper plus 1 peer.",
    ariaLabel: "Compare with 1 peer ready",
  });
});

test("getPaperCompareButtonState keeps the default label when compare is unavailable", () => {
  const state = getPaperCompareButtonState({
    currentPaperTitle: "Current Paper",
    groups: [],
  });

  assert.deepEqual(state, {
    enabled: false,
    reason: "Need at least one recommended peer before compare can run.",
    candidateCount: 0,
    label: "Compare",
    title: "Need at least one recommended peer before compare can run.",
    ariaLabel:
      "Compare unavailable: Need at least one recommended peer before compare can run.",
  });
});

test("getPaperCompareButtonState surfaces bounded multi-peer readiness copy", () => {
  const state = getPaperCompareButtonState({
    currentPaperTitle: "Current Paper",
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Paper B",
            authors: ["Ada Lovelace"],
            relevanceScore: 0.9,
          },
          {
            title: "Paper C",
            authors: ["Grace Hopper"],
            relevanceScore: 0.8,
          },
          {
            title: "Paper D",
            authors: ["Barbara Liskov"],
            relevanceScore: 0.7,
          },
          {
            title: "Paper E",
            authors: ["Margaret Hamilton"],
            relevanceScore: 0.6,
          },
        ],
      },
    ],
  });

  assert.deepEqual(state, {
    enabled: true,
    reason: "Compare will use the current paper plus 3 peers.",
    candidateCount: 3,
    label: "Compare (3)",
    title: "Compare will use the current paper plus 3 peers.",
    ariaLabel: "Compare with 3 peers ready",
  });
});

test("getPaperCompareWorkflowState explains the loading step while recommendations are running", () => {
  const state = getPaperCompareWorkflowState({
    currentPaperTitle: "Current Paper",
    groups: [],
    recommendationsRunning: true,
  });

  assert.deepEqual(state, {
    enabled: false,
    helperText:
      "Step 1 of 2: Finding related papers… Compare unlocks when recommendations are ready.",
    tone: "muted",
    candidateCount: 0,
  });
});

test("getPaperCompareWorkflowState tells users to recommend related papers first", () => {
  const state = getPaperCompareWorkflowState({
    currentPaperTitle: "Current Paper",
    groups: [],
  });

  assert.deepEqual(state, {
    enabled: false,
    helperText:
      "Step 1 of 2: Run Recommend related papers. Step 2 of 2: Compare unlocks after at least one peer is ready.",
    tone: "muted",
    candidateCount: 0,
  });
});

test("getPaperCompareWorkflowState falls back to metadata-unavailable copy", () => {
  const state = getPaperCompareWorkflowState({
    currentPaperTitle: "   ",
    groups: [],
  });

  assert.deepEqual(state, {
    enabled: false,
    helperText: "Current paper metadata is unavailable.",
    tone: "muted",
    candidateCount: 0,
  });
});

test("getPaperCompareWorkflowState reports a ready compare step once peers exist", () => {
  const state = getPaperCompareWorkflowState({
    currentPaperTitle: "Current Paper",
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Peer Paper",
            authors: ["Ada Lovelace"],
            relevanceScore: 0.9,
          },
        ],
      },
    ],
  });

  assert.deepEqual(state, {
    enabled: true,
    helperText: "Step 2 of 2: Compare is ready with 1 recommended peer.",
    tone: "ready",
    candidateCount: 1,
  });
});

test("getPaperCompareWorkflowState reports bounded multi-peer readiness copy", () => {
  const state = getPaperCompareWorkflowState({
    currentPaperTitle: "Current Paper",
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Paper B",
            authors: ["Ada Lovelace"],
            relevanceScore: 0.9,
          },
          {
            title: "Paper C",
            authors: ["Grace Hopper"],
            relevanceScore: 0.8,
          },
          {
            title: "Paper D",
            authors: ["Barbara Liskov"],
            relevanceScore: 0.7,
          },
          {
            title: "Paper E",
            authors: ["Margaret Hamilton"],
            relevanceScore: 0.6,
          },
        ],
      },
    ],
  });

  assert.deepEqual(state, {
    enabled: true,
    helperText: "Step 2 of 2: Compare is ready with 3 recommended peers.",
    tone: "ready",
    candidateCount: 3,
  });
});

test("compare pipeline builds a compare request and shapes the parsed response into an artifact card", () => {
  const request = buildPaperCompareRequestFromRecommendations({
    currentPaper: {
      title: "Current Paper",
      authors: ["Ada Lovelace"],
      year: 2026,
      abstract: "Current abstract.",
    },
    groups: [
      {
        category: "Closest match",
        papers: [
          {
            title: "Paper B",
            authors: ["Grace Hopper"],
            year: 2025,
            abstract: "Compare abstract.",
            relevanceScore: 0.9,
            reason: "Recommended follow-up",
          },
          {
            title: "Paper C",
            authors: ["Barbara Liskov"],
            year: 2024,
            relevanceScore: 0.8,
            reason: "Alternative baseline",
          },
        ],
      },
    ],
  });

  const result = parsePaperCompareResponse(
    JSON.stringify({
      overview:
        "Current Paper is faster to use while Paper B and Paper C broaden context.",
      papers: [
        {
          title: "Current Paper",
          relationship: "Fast in-pane baseline",
          strengths: ["Integrated Zotero workflow"],
          tradeoffs: ["Single-paper emphasis"],
        },
        {
          title: "Paper B",
          relationship: "Closest follow-up",
          strengths: ["Richer benchmark detail"],
          tradeoffs: ["Heavier setup"],
          bestUseCase: "Read second for validation depth",
        },
        {
          title: "Paper C",
          relationship: "Alternative baseline",
          strengths: ["Good contrastive framing"],
          tradeoffs: ["Less direct integration"],
        },
      ],
      synthesis: [
        "Start in-pane with Current Paper, then branch to B or C depending on depth needed.",
      ],
      recommendations: [
        "Read Paper B first if you want the closest extension.",
      ],
    }),
  );

  const card = buildPaperCompareCard(result);

  assert.equal(request.selection.comparePapers.length, 2);
  assert.match(request.prompt, /Comparison set:/);
  assert.equal(card.kind, "paper-compare");
  assert.equal(card.title, "Compare papers");
  assert.match(card.summary, /faster to use/);
  assert.equal(card.sections[0].heading, "Paper snapshots");
  assert.match(
    card.sections[0].items[0],
    /Current Paper: Fast in-pane baseline/,
  );
  assert.equal(card.sections[2].heading, "Recommended next reading");
});

test("buildPaperCompareCardFromResponse converts raw compare JSON straight into a compare card", () => {
  const card = buildPaperCompareCardFromResponse(
    JSON.stringify({
      overview: "Paper A is quicker while Paper B is broader.",
      papers: [
        {
          title: "Paper A",
          relationship: "Fast baseline",
          strengths: ["Quick to apply"],
          tradeoffs: ["Narrow scope"],
        },
        {
          title: "Paper B",
          relationship: "Broader follow-up",
          strengths: ["Richer benchmark"],
          tradeoffs: ["More setup"],
          bestUseCase: "Read second",
        },
      ],
      synthesis: ["Use A first, then B for broader context."],
      recommendations: ["Read Paper B second."],
    }),
  );

  assert.equal(card.kind, "paper-compare");
  assert.equal(card.title, "Compare papers");
  assert.match(card.summary, /quicker/);
  assert.equal(card.sections[0].heading, "Paper snapshots");
  assert.equal(card.sections[2].heading, "Recommended next reading");
});

test("buildPaperCompareQuestion includes current and bounded comparison papers", () => {
  const prompt = buildPaperCompareQuestion({
    currentPaper: {
      title: "Current Paper",
      authors: ["Ada Lovelace"],
      year: 2026,
      abstract: "Current abstract.",
    },
    comparePapers: [
      { title: "Paper B" },
      { title: "Paper C" },
      { title: "Paper D" },
      { title: "Paper E" },
    ],
  });

  assert.match(prompt, /Return ONLY one strict JSON object/i);
  assert.match(prompt, /Current paper:/);
  assert.match(prompt, /Title: Current Paper/);
  assert.match(prompt, /do not invent extra papers or missing details/i);
  assert.match(prompt, /reader-pane-safe/i);
  assert.doesNotMatch(prompt, /Title: Paper E/);
  assert.match(
    prompt,
    /recommendations should be actionable next-reading advice/i,
  );
});

test("buildPaperCompareQuestion includes preferred response language guidance", () => {
  const prompt = buildPaperCompareQuestion({
    currentPaper: { title: "Current Paper" },
    comparePapers: [{ title: "Paper B" }],
    responseLanguage: "English",
  });

  assert.match(prompt, /Respond in English/i);
  assert.match(prompt, /Use English technical terms/i);
});

test("parsePaperCompareResponse parses fenced JSON and normalizes lists", () => {
  const result = parsePaperCompareResponse(`\`\`\`json
${JSON.stringify({
  overview: "Current paper complements the methods paper.",
  papers: [
    {
      title: "Current Paper",
      relationship: "Baseline reader workflow",
      strengths: ["Integrated Zotero reader"],
      tradeoffs: ["Single-paper focus"],
      bestUseCase: "Fast in-pane review",
    },
    {
      title: "Methods Paper",
      relationship: "Adds deeper comparison context",
      strengths: ["Better benchmarking breadth", "Clear ablations"],
      tradeoffs: ["Heavier setup"],
    },
  ],
  synthesis: [
    "The current paper is faster to use; the methods paper broadens context.",
  ],
  recommendations: [
    "Read the methods paper after the current paper for validation context.",
  ],
})}
\`\`\``);

  assert.equal(result.papers.length, 2);
  assert.equal(result.papers[1].title, "Methods Paper");
  assert.equal(
    result.recommendations[0],
    "Read the methods paper after the current paper for validation context.",
  );
});

test("parsePaperCompareResponse rejects compare output without synthesis", () => {
  assert.throws(
    () =>
      parsePaperCompareResponse(
        JSON.stringify({
          overview: "Overview",
          papers: [
            {
              title: "Current Paper",
              relationship: "Base",
              strengths: ["A"],
              tradeoffs: ["B"],
            },
            {
              title: "Other Paper",
              relationship: "Contrast",
              strengths: ["C"],
              tradeoffs: ["D"],
            },
          ],
          synthesis: [],
          recommendations: [],
        }),
      ),
    /synthesis or recommendations/i,
  );
});

test("parsePaperCompareResponse extracts embedded JSON from prose", () => {
  const result = parsePaperCompareResponse(
    `Here is the compact compare:\n${JSON.stringify({
      overview: "Paper A is faster; Paper B is broader.",
      papers: [
        {
          title: "Paper A",
          relationship: "Fast baseline",
          strengths: ["Quick to apply"],
          tradeoffs: ["Narrow scope"],
        },
        {
          title: "Paper B",
          relationship: "Broader survey",
          strengths: ["More context"],
          tradeoffs: ["Heavier workflow"],
        },
      ],
      synthesis: ["Use A first, then B for broader context."],
      recommendations: ["Read Paper B second."],
    })}\nDone.`,
  );

  assert.equal(result.overview, "Paper A is faster; Paper B is broader.");
  assert.equal(result.papers[0].title, "Paper A");
  assert.equal(result.synthesis[0], "Use A first, then B for broader context.");
});

test("buildPaperCompareCard shapes a compact compare artifact card", () => {
  const card = buildPaperCompareCard({
    overview: "Compact compare summary.",
    papers: [
      {
        title: "Current Paper",
        relationship: "Best for quick in-pane work",
        strengths: ["Integrated pane"],
        tradeoffs: ["Narrow scope"],
      },
      {
        title: "Paper B",
        relationship: "Broader multi-paper coverage",
        strengths: ["Richer survey breadth"],
        tradeoffs: ["More setup"],
        bestUseCase: "Cross-checking alternatives",
      },
    ],
    synthesis: ["Together they cover quick execution and broader context."],
    recommendations: [
      "Start with Current Paper, then read Paper B for synthesis depth.",
    ],
  });

  assert.equal(card.kind, "paper-compare");
  assert.equal(card.sections[0].heading, "Paper snapshots");
  assert.equal(card.sections[1].evidence, "mixed");
  assert.equal(card.sections[2].evidence, "inference");
});

test("getPaperCompareMetrics reports a bounded compact compare scope", () => {
  const metrics = getPaperCompareMetrics({
    overview: "Compact compare summary.",
    papers: [
      {
        title: "Current Paper",
        relationship: "Best for quick in-pane work",
        strengths: ["Integrated pane"],
        tradeoffs: ["Narrow scope"],
      },
      {
        title: "Paper B",
        relationship: "Broader multi-paper coverage",
        strengths: ["Richer survey breadth"],
        tradeoffs: ["More setup"],
      },
    ],
    synthesis: ["Together they cover quick execution and broader context."],
    recommendations: [
      "Start with Current Paper, then read Paper B for synthesis depth.",
    ],
  });

  assert.deepEqual(metrics, {
    comparedPaperCount: 2,
    snapshotCount: 2,
    synthesisCount: 1,
    recommendationCount: 1,
    hasInferenceContent: true,
    compactSafe: true,
  });
});

test("getPaperCompareMetrics flags oversized compare output as not compact safe", () => {
  const metrics = getPaperCompareMetrics({
    overview: "Large compare summary.",
    papers: [
      {
        title: "Current Paper",
        relationship: "Anchor",
        strengths: ["A"],
        tradeoffs: ["B"],
      },
      {
        title: "Paper B",
        relationship: "Peer 1",
        strengths: ["C"],
        tradeoffs: ["D"],
      },
      {
        title: "Paper C",
        relationship: "Peer 2",
        strengths: ["E"],
        tradeoffs: ["F"],
      },
      {
        title: "Paper D",
        relationship: "Peer 3",
        strengths: ["G"],
        tradeoffs: ["H"],
      },
    ],
    synthesis: ["S1", "S2", "S3", "S4", "S5"],
    recommendations: ["R1"],
  });

  assert.equal(metrics.compactSafe, false);
});

test("getPaperCompareMetrics reports no inference content when recommendations are empty", () => {
  const metrics = getPaperCompareMetrics({
    overview: "Compact compare summary.",
    papers: [
      {
        title: "Current Paper",
        relationship: "Baseline",
        strengths: ["Integrated pane"],
        tradeoffs: ["Narrow scope"],
      },
      {
        title: "Paper B",
        relationship: "Contrast",
        strengths: ["Broader context"],
        tradeoffs: ["More setup"],
      },
    ],
    synthesis: ["Shared framing, different emphasis."],
    recommendations: [],
  });

  assert.deepEqual(metrics, {
    comparedPaperCount: 2,
    snapshotCount: 2,
    synthesisCount: 1,
    recommendationCount: 0,
    hasInferenceContent: false,
    compactSafe: true,
  });
});
