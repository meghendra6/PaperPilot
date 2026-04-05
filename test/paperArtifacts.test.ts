import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildPaperArtifactRequest,
  getPaperArtifactCardMetrics,
  getPaperArtifactEvidencePresentation,
  parsePaperArtifactCard,
} from "../src/modules/paperArtifacts";

test("buildPaperArtifactRequest builds research brief prompts from item metadata", () => {
  const request = buildPaperArtifactRequest(
    {
      getField: (field: string) => {
        if (field === "title") return "Reader Workbench";
        if (field === "year") return "2026";
        if (field === "abstractNote") return "Structured paper workflows.";
        return "";
      },
      getCreators: () => [{ firstName: "Ada", lastName: "Lovelace" }],
    } as any,
    "research-brief",
  );

  assert.equal(request.kind, "research-brief");
  assert.equal(request.label, "Research brief");
  assert.match(request.prompt, /Reader Workbench/);
  assert.match(request.prompt, /Return ONLY one strict JSON object/i);
});

test("parsePaperArtifactCard converts research brief JSON into compact card sections", () => {
  const card = parsePaperArtifactCard(
    "research-brief",
    JSON.stringify({
      summary: "A concise structured summary.",
      contributions: ["Contribution A"],
      methods: ["Method A"],
      limitations: ["Limitation A"],
      followUpQuestions: ["Question A"],
      searchQueries: [
        { query: "paper workflow tooling", rationale: "find follow-ups" },
      ],
    }),
  );

  assert.equal(card.kind, "research-brief");
  assert.equal(card.sections.length, 4);
  assert.equal(card.sections[0].evidence, "explicit");
  assert.equal(card.sections[3].evidence, "inference");
  assert.match(card.sourceLabel, /model-assisted inference/i);
});

test("parsePaperArtifactCard converts paper-tool output into shared card shape", () => {
  const card = parsePaperArtifactCard(
    "extract-limitations",
    JSON.stringify({
      overview: "The paper has clear boundary conditions.",
      sections: [
        {
          heading: "Explicit limitations from the paper",
          bullets: ["Small evaluation set"],
          evidence: "explicit",
        },
        {
          heading: "Implied assumptions",
          bullets: ["Stable metadata quality"],
          evidence: "inference",
        },
      ],
    }),
  );

  assert.equal(card.kind, "extract-limitations");
  assert.equal(card.title, "Extract limitations");
  assert.equal(card.sections[1].items[0], "Stable metadata quality");
  assert.equal(card.sections[1].evidence, "inference");
});

test("getPaperArtifactEvidencePresentation shapes evidence labels for future card rendering", () => {
  assert.deepEqual(getPaperArtifactEvidencePresentation("explicit"), {
    label: "Directly grounded in the paper",
    tone: "grounded",
  });
  assert.deepEqual(getPaperArtifactEvidencePresentation("inference"), {
    label: "Model inference / extrapolation",
    tone: "caution",
  });
  assert.deepEqual(getPaperArtifactEvidencePresentation("mixed"), {
    label: "Mixed evidence: paper-grounded + inference",
    tone: "neutral",
  });
});

test("getPaperArtifactCardMetrics summarizes compact-card rendering needs", () => {
  const card = parsePaperArtifactCard(
    "research-brief",
    JSON.stringify({
      summary: "Summary.",
      contributions: ["Contribution A"],
      methods: ["Method A"],
      limitations: ["Limitation A"],
      followUpQuestions: ["Question A"],
      searchQueries: [{ query: "tooling workflow" }],
    }),
  );

  assert.deepEqual(getPaperArtifactCardMetrics(card), {
    sectionCount: 4,
    itemCount: 4,
    hasInferenceContent: true,
    hasExplicitContent: true,
    hasSearchQueries: true,
  });
});
