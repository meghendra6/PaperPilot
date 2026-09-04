import type { StructuredOutputSchema } from "../ai/structuredOutput";

type JsonSchema = Record<string, unknown>;

const stringSchema = { type: "string" } as const;
const numberSchema = { type: "number" } as const;
const booleanSchema = { type: "boolean" } as const;

function strictObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function arrayOf(items: JsonSchema): JsonSchema {
  return { type: "array", items };
}

function enumOf(values: readonly string[]): JsonSchema {
  return { type: "string", enum: [...values] };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

const stringArray = arrayOf(stringSchema);

const locatorProperties = {
  pageIndex: nullable({ type: "integer", minimum: 0 }),
  pageLabel: nullable(stringSchema),
  sectionPath: stringArray,
  elementType: nullable(
    enumOf([
      "paragraph",
      "figure",
      "table",
      "equation",
      "footnote",
      "appendix",
      "other",
    ]),
  ),
  quote: nullable(stringSchema),
  confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
};

const sourceEvidenceReference = strictObject({
  sourceID: stringSchema,
  libraryID: { type: "integer", minimum: 1 },
  attachmentKey: stringSchema,
  ...locatorProperties,
});

const attachmentEvidenceReference = strictObject({
  attachmentKey: stringSchema,
  ...locatorProperties,
});

const sourceEvidenceArray = arrayOf(sourceEvidenceReference);
const attachmentEvidenceArray = arrayOf(attachmentEvidenceReference);

const claimLedger = strictObject({
  claims: arrayOf(
    strictObject({
      id: stringSchema,
      text: stringSchema,
      kind: enumOf([
        "author_claim",
        "empirical_result",
        "assumption",
        "reader_inference",
        "external_evidence",
      ]),
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
      support: sourceEvidenceArray,
      contradictions: sourceEvidenceArray,
      verificationStatus: enumOf([
        "verified",
        "partially_verified",
        "unverified",
        "conflicting",
      ]),
    }),
  ),
});

const criticalRead = strictObject({
  executiveSummary: stringSchema,
  strengths: stringArray,
  checks: arrayOf(
    strictObject({
      checkId: stringSchema,
      status: enumOf([
        "supported",
        "partial",
        "unsupported",
        "not_applicable",
        "unclear",
      ]),
      severity: enumOf(["none", "minor", "major", "critical"]),
      finding: stringSchema,
      implication: stringSchema,
      evidence: sourceEvidenceArray,
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
    }),
  ),
  discriminatingExperiments: arrayOf(
    strictObject({
      hypothesis: stringSchema,
      experiment: stringSchema,
      expectedOutcomes: stringArray,
      evidence: sourceEvidenceArray,
    }),
  ),
  residualUncertainty: stringArray,
});

const reproducibility = strictObject({
  summary: stringSchema,
  artifacts: arrayOf(
    strictObject({
      id: stringSchema,
      kind: enumOf([
        "code",
        "commit",
        "dataset",
        "data",
        "model",
        "environment",
        "hardware",
        "training_config",
        "training",
        "inference_config",
        "inference",
        "evaluation_command",
        "evaluation",
        "random_seeds",
        "license",
        "results",
        "other",
      ]),
      label: stringSchema,
      availability: enumOf([
        "available",
        "partial",
        "missing",
        "not_applicable",
        "unclear",
      ]),
      value: nullable(stringSchema),
      url: nullable(stringSchema),
      version: nullable(stringSchema),
      notes: nullable(stringSchema),
      evidence: sourceEvidenceArray,
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
    }),
  ),
  blockers: arrayOf(
    strictObject({
      id: stringSchema,
      severity: enumOf(["minor", "major", "critical"]),
      description: stringSchema,
      mitigation: stringSchema,
      evidence: sourceEvidenceArray,
    }),
  ),
  minimalReproductionSteps: stringArray,
  verificationCommands: stringArray,
});

const paperToCode = strictObject({
  objective: stringSchema,
  inputs: stringArray,
  outputs: stringArray,
  summary: stringSchema,
  pseudocode: stringSchema,
  tensorTrace: arrayOf(
    strictObject({
      id: stringSchema,
      stage: stringSchema,
      inputShape: stringSchema,
      outputShape: stringSchema,
      operation: stringSchema,
      stateChanges: stringArray,
      memoryAccess: stringArray,
      evidence: sourceEvidenceArray,
    }),
  ),
  invariants: arrayOf(
    strictObject({
      id: stringSchema,
      statement: stringSchema,
      consequence: stringSchema,
      evidence: sourceEvidenceArray,
    }),
  ),
  complexity: strictObject({
    time: stringSchema,
    memory: stringSchema,
    communication: nullable(stringSchema),
    assumptions: stringArray,
    evidence: sourceEvidenceArray,
  }),
  ambiguities: arrayOf(
    strictObject({
      id: stringSchema,
      question: stringSchema,
      risk: enumOf(["low", "medium", "high", "unknown"]),
      suggestedResolution: stringSchema,
      evidence: sourceEvidenceArray,
    }),
  ),
  paperCodeDivergences: arrayOf(
    strictObject({
      area: stringSchema,
      paperStatement: stringSchema,
      codeBehavior: stringSchema,
      impact: stringSchema,
      evidence: sourceEvidenceArray,
    }),
  ),
  minimalReproduction: stringArray,
  validationTests: stringArray,
});

const evidenceMatrixRow = strictObject({
  title: stringSchema,
  cells: arrayOf(
    strictObject({
      columnId: stringSchema,
      value: {
        anyOf: [
          stringSchema,
          numberSchema,
          booleanSchema,
          stringArray,
          { type: "null" },
        ],
      },
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
      evidence: sourceEvidenceArray,
      notes: nullable(stringSchema),
    }),
  ),
});

const relationshipGraph = strictObject({
  nodes: arrayOf(
    strictObject({
      id: stringSchema,
      kind: enumOf(["paper", "concept", "claim", "method", "dataset"]),
      label: stringSchema,
      paperKey: nullable(stringSchema),
    }),
  ),
  edges: arrayOf(
    strictObject({
      id: stringSchema,
      source: stringSchema,
      target: stringSchema,
      kind: enumOf([
        "introduces",
        "uses",
        "extends",
        "improves",
        "challenges",
        "supports",
        "contradicts",
        "compares",
        "evaluates_on",
        "related",
      ]),
      label: nullable(stringSchema),
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
      evidence: sourceEvidenceArray,
      bibliographicProvenance: nullable(
        strictObject({
          kind: enumOf([
            "local-reference",
            "zotero-relation",
            "admitted-metadata",
          ]),
          sourceID: stringSchema,
          identifier: nullable(stringSchema),
        }),
      ),
      verified: booleanSchema,
    }),
  ),
});

const crossPaperQuestion = strictObject({
  id: stringSchema,
  mode: enumOf(["compare", "synthesis", "conflict", "transfer", "timeline"]),
  prompt: stringSchema,
  paperKeys: arrayOf(stringSchema),
  difficulty: enumOf(["intermediate", "advanced"]),
  criteria: arrayOf(
    strictObject({
      id: stringSchema,
      description: stringSchema,
      maxScore: { type: "number", minimum: 1, maximum: 20 },
      paperKeys: arrayOf(stringSchema),
      requiredClaims: stringArray,
      evidence: sourceEvidenceArray,
    }),
  ),
});

const crossPaperGrade = strictObject({
  criterionScores: arrayOf(
    strictObject({
      criterionId: stringSchema,
      score: { type: "number", minimum: 0 },
      feedback: stringSchema,
      evidence: sourceEvidenceArray,
    }),
  ),
  feedback: stringSchema,
  misconceptions: stringArray,
  graderConfidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
});

const citationStance = strictObject({
  results: arrayOf(
    strictObject({
      contextId: stringSchema,
      stance: enumOf([
        "supporting",
        "contrasting",
        "methodological",
        "mentioning",
        "background",
        "uncertain",
      ]),
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 }),
      rationale: stringSchema,
      claim: nullable(stringSchema),
      limitations: stringArray,
    }),
  ),
});

const masteryExpectedClaim = strictObject({
  id: stringSchema,
  text: stringSchema,
  required: booleanSchema,
  evidence: attachmentEvidenceArray,
});

const masteryRubricCriterion = strictObject({
  id: stringSchema,
  description: stringSchema,
  maxScore: { type: "number", exclusiveMinimum: 0 },
  essential: booleanSchema,
  evidence: attachmentEvidenceArray,
});

const masteryBlueprint = strictObject({
  blueprint: strictObject({
    paperTitle: stringSchema,
    concepts: arrayOf(
      strictObject({
        id: stringSchema,
        name: stringSchema,
        dimension: enumOf([
          "contribution",
          "mechanism",
          "assumption",
          "evidence",
          "limitation",
          "transfer",
        ]),
        importance: enumOf(["core", "supporting"]),
        learningObjective: stringSchema,
        prerequisites: stringArray,
        expectedClaims: arrayOf(masteryExpectedClaim),
        evidence: attachmentEvidenceArray,
        rubric: arrayOf(masteryRubricCriterion),
      }),
    ),
  }),
});

const masteryQuestion = strictObject({
  question: strictObject({
    conceptId: stringSchema,
    difficulty: enumOf(["foundational", "intermediate", "advanced"]),
    mode: enumOf([
      "recall",
      "teach_back",
      "figure_explanation",
      "mechanism_trace",
      "counterfactual",
      "transfer",
      "comparison",
    ]),
    prompt: stringSchema,
  }),
});

const masteryGrade = strictObject({
  grade: strictObject({
    criterionGrades: arrayOf(
      strictObject({
        criterionId: stringSchema,
        score: { type: "number", minimum: 0 },
        feedback: stringSchema,
        evidence: attachmentEvidenceArray,
      }),
    ),
    misconceptions: arrayOf(
      strictObject({
        statement: stringSchema,
        severity: enumOf(["minor", "major"]),
        evidence: attachmentEvidenceArray,
      }),
    ),
    overallFeedback: stringSchema,
    explanation: stringSchema,
    graderConfidence: { type: "number", minimum: 0, maximum: 1 },
  }),
});

const synthesisStatement = strictObject({
  statement: stringSchema,
  sourceIDs: stringArray,
  evidence: sourceEvidenceArray,
  support: enumOf(["verified", "inferred", "insufficient"]),
  uncertainty: nullable(stringSchema),
});

const synthesis = strictObject({
  answer: stringSchema,
  claims: arrayOf(synthesisStatement),
  agreements: arrayOf(synthesisStatement),
  contradictions: arrayOf(synthesisStatement),
  unresolvedUncertainty: stringArray,
  freshnessWarnings: stringArray,
});

export const RESEARCH_WORKSPACE_OUTPUT_SCHEMAS = {
  claimLedger,
  criticalRead,
  reproducibility,
  paperToCode,
  evidenceMatrixRow,
  relationshipGraph,
  crossPaperQuestion,
  crossPaperGrade,
  citationStance,
  masteryBlueprint,
  masteryQuestion,
  masteryGrade,
  synthesis,
} as const;

export function researchWorkspaceOutputSchemaForPurpose(
  purpose: string,
): StructuredOutputSchema {
  if (purpose === "claim-extraction") return claimLedger;
  if (
    purpose.startsWith("critical-read-") ||
    purpose.startsWith("methodology-audit-")
  )
    return criticalRead;
  if (purpose === "reproducibility-audit") return reproducibility;
  if (purpose === "paper-to-code") return paperToCode;
  if (purpose.startsWith("matrix-")) return evidenceMatrixRow;
  if (purpose === "literature-graph") return relationshipGraph;
  if (purpose === "cross-paper-question") return crossPaperQuestion;
  if (purpose === "cross-paper-grade") return crossPaperGrade;
  if (purpose === "citation-stance") return citationStance;
  if (purpose === "mastery-blueprint") return masteryBlueprint;
  if (purpose === "mastery-question") return masteryQuestion;
  if (purpose === "mastery-grade") return masteryGrade;
  if (purpose === "project-synthesis") return synthesis;
  throw new Error(`Unsupported Research Workspace output purpose: ${purpose}`);
}
