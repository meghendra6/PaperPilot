import type { StructuredOutputSchema } from "../ai/structuredOutput";

const array = { type: "array", items: { type: "object" } } as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): StructuredOutputSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: true,
  };
}

export const RESEARCH_WORKSPACE_OUTPUT_SCHEMAS = {
  claimLedger: objectSchema({ claims: array }, ["claims"]),
  criticalRead: objectSchema(
    {
      executiveSummary: { type: "string" },
      checks: array,
      strengths: { type: "array", items: { type: "string" } },
      residualUncertainty: { type: "array", items: { type: "string" } },
    },
    ["executiveSummary", "checks"],
  ),
  reproducibility: objectSchema(
    { summary: { type: "string" }, artifacts: array, blockers: array },
    ["artifacts", "blockers"],
  ),
  paperToCode: objectSchema(
    {
      summary: { type: "string" },
      pseudocode: { type: "string" },
      invariants: array,
      complexity: { type: "object" },
    },
    ["summary", "pseudocode", "invariants", "complexity"],
  ),
  evidenceMatrixRow: objectSchema({ cells: array }, ["cells"]),
  relationshipGraph: objectSchema({ nodes: array, edges: array }, [
    "nodes",
    "edges",
  ]),
  crossPaperQuestion: objectSchema(
    {
      prompt: { type: "string" },
      paperKeys: { type: "array", items: { type: "string" } },
      rubric: array,
    },
    ["prompt", "paperKeys", "rubric"],
  ),
  crossPaperGrade: objectSchema({ grades: array }, ["grades"]),
  citationStance: objectSchema({ results: array }, ["results"]),
  mastery: objectSchema({}, []),
  synthesis: objectSchema(
    {
      answer: { type: "string" },
      claims: array,
      agreements: array,
      contradictions: array,
      unresolvedUncertainty: { type: "array", items: { type: "string" } },
      coverage: { type: "object" },
    },
    ["answer", "claims", "coverage"],
  ),
} as const;

export function researchWorkspaceOutputSchemaForPurpose(
  purpose: string,
): StructuredOutputSchema {
  if (purpose === "claim-extraction")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.claimLedger;
  if (
    purpose.startsWith("critical-read-") ||
    purpose.startsWith("methodology-audit-")
  )
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.criticalRead;
  if (purpose === "reproducibility-audit")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.reproducibility;
  if (purpose === "paper-to-code")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.paperToCode;
  if (purpose.startsWith("matrix-"))
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.evidenceMatrixRow;
  if (purpose === "literature-graph")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.relationshipGraph;
  if (purpose === "cross-paper-question")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.crossPaperQuestion;
  if (purpose === "cross-paper-grade")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.crossPaperGrade;
  if (purpose === "citation-stance")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.citationStance;
  if (purpose.startsWith("mastery-"))
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.mastery;
  if (purpose === "project-synthesis")
    return RESEARCH_WORKSPACE_OUTPUT_SCHEMAS.synthesis;
  return objectSchema({}, []);
}
