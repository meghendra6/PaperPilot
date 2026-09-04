import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  RESEARCH_WORKSPACE_OUTPUT_SCHEMAS,
  researchWorkspaceOutputSchemaForPurpose,
} from "../src/modules/researchWorkspace/outputSchemas";
import { parseCrossPaperGradeResponse } from "../src/modules/researchWorkspace/core/crossPaperMastery/parser";

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOpenAIStrictObjects(value: unknown, path = "$schema") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertOpenAIStrictObjects(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!isSchema(value)) return;

  if (value.type === "object") {
    assert.equal(
      value.additionalProperties,
      false,
      `${path} must set additionalProperties to false`,
    );
    assert.ok(isSchema(value.properties), `${path} must declare properties`);
    assert.ok(Array.isArray(value.required), `${path} must declare required`);
    assert.deepEqual(
      [...(value.required as string[])].sort(),
      Object.keys(value.properties as Schema).sort(),
      `${path} must require every declared property`,
    );
  }

  for (const [key, child] of Object.entries(value)) {
    assertOpenAIStrictObjects(child, `${path}.${key}`);
  }
}

const purposeContracts = new Map<string, string[]>([
  ["claim-extraction", ["claims"]],
  [
    "methodology-audit-empirical_ml",
    [
      "executiveSummary",
      "strengths",
      "checks",
      "discriminatingExperiments",
      "residualUncertainty",
    ],
  ],
  [
    "critical-read-systems",
    [
      "executiveSummary",
      "strengths",
      "checks",
      "discriminatingExperiments",
      "residualUncertainty",
    ],
  ],
  [
    "reproducibility-audit",
    [
      "summary",
      "artifacts",
      "blockers",
      "minimalReproductionSteps",
      "verificationCommands",
    ],
  ],
  [
    "paper-to-code",
    [
      "objective",
      "inputs",
      "outputs",
      "summary",
      "pseudocode",
      "tensorTrace",
      "invariants",
      "complexity",
      "ambiguities",
      "paperCodeDivergences",
      "minimalReproduction",
      "validationTests",
    ],
  ],
  ["matrix-project-row", ["title", "cells"]],
  ["literature-graph", ["nodes", "edges"]],
  [
    "cross-paper-question",
    ["id", "mode", "prompt", "paperKeys", "difficulty", "criteria"],
  ],
  [
    "cross-paper-grade",
    ["criterionScores", "feedback", "misconceptions", "graderConfidence"],
  ],
  ["citation-stance", ["results"]],
  ["mastery-blueprint", ["blueprint"]],
  ["mastery-question", ["question"]],
  ["mastery-grade", ["grade"]],
  [
    "project-synthesis",
    [
      "answer",
      "claims",
      "agreements",
      "contradictions",
      "unresolvedUncertainty",
      "freshnessWarnings",
    ],
  ],
]);

test("every Research Workspace output schema satisfies OpenAI strict object rules", () => {
  for (const [name, schema] of Object.entries(
    RESEARCH_WORKSPACE_OUTPUT_SCHEMAS,
  )) {
    assertOpenAIStrictObjects(schema, name);
  }
});

test("every Research Workspace run purpose selects its parser-aligned schema", () => {
  for (const [purpose, expectedProperties] of purposeContracts) {
    const schema = researchWorkspaceOutputSchemaForPurpose(purpose);
    assertOpenAIStrictObjects(schema, purpose);
    assert.ok(isSchema(schema.properties));
    assert.deepEqual(Object.keys(schema.properties), expectedProperties);
  }
});

test("unknown purposes fail before a mismatched schema reaches a provider", () => {
  assert.throws(
    () => researchWorkspaceOutputSchemaForPurpose("unknown-purpose"),
    /Unsupported Research Workspace output purpose: unknown-purpose/,
  );
});

test("cross-paper grade schema fixture round-trips through its parser", () => {
  const fixture = {
    criterionScores: [
      {
        criterionId: "criterion-1",
        score: 4,
        feedback: "Connects the two papers with local evidence.",
        evidence: [],
      },
    ],
    feedback: "Strong synthesis with one remaining qualification.",
    misconceptions: ["The second paper does not claim causality."],
    graderConfidence: 0.8,
  };

  const parsed = parseCrossPaperGradeResponse({
    response: JSON.stringify(fixture),
    question: {
      id: "question-1",
      rubric: [
        {
          id: "criterion-1",
          maxScore: 5,
          requiredPaperKeys: ["paper-a", "paper-b"],
        },
      ],
    },
    answer: "A grounded comparison.",
    learnerConfidence: 0.6,
    now: "2026-09-03T00:00:00.000Z",
  });

  assert.equal(parsed.feedback, fixture.feedback);
  assert.equal(parsed.graderConfidence, fixture.graderConfidence);
  assert.equal(parsed.learnerConfidence, 0.6);
  assert.deepEqual(parsed.misconceptions, fixture.misconceptions);
  assert.equal(parsed.grades[0].criterionId, "criterion-1");
  assert.equal(parsed.grades[0].score, 4);
});
