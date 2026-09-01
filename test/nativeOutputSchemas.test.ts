import { test } from "node:test";
import * as assert from "node:assert/strict";

import { nativeStructuredOutputSchemaIssue } from "../src/modules/ai/structuredOutput";
import { AUTO_HIGHLIGHT_OUTPUT_SCHEMA } from "../src/modules/autoHighlight/prompt";
import {
  MASTERY_EVALUATION_OUTPUT_SCHEMA,
  MASTERY_QUESTION_OUTPUT_SCHEMA,
} from "../src/modules/comprehensionCheck/prompt";
import { getCriticalReadOutputSchema } from "../src/modules/criticalRead/prompt";
import {
  DISCOVERY_OUTPUT_SCHEMA,
  PUBLIC_REVIEW_OUTPUT_SCHEMA,
} from "../src/modules/discovery/prompt";
import { PAPER_COMPARE_OUTPUT_SCHEMA } from "../src/modules/paperCompare";
import { PAPER_TOOL_OUTPUT_SCHEMA } from "../src/modules/paperTools";
import { RESEARCH_BRIEF_OUTPUT_SCHEMA } from "../src/modules/researchBrief";
import { RESEARCH_WORKSPACE_OUTPUT_SCHEMAS } from "../src/modules/researchWorkspace/outputSchemas";

test("every shipped native output schema satisfies provider strict object rules", () => {
  const schemas = [
    ["autoHighlight", AUTO_HIGHLIGHT_OUTPUT_SCHEMA],
    ["masteryQuestion", MASTERY_QUESTION_OUTPUT_SCHEMA],
    ["masteryEvaluation", MASTERY_EVALUATION_OUTPUT_SCHEMA],
    ["criticalReadStep1", getCriticalReadOutputSchema(1)],
    ["criticalReadStep2", getCriticalReadOutputSchema(2)],
    ["criticalReadStep4", getCriticalReadOutputSchema(4)],
    ["criticalReadStep5", getCriticalReadOutputSchema(5)],
    ["criticalReadStep6", getCriticalReadOutputSchema(6)],
    ["criticalReadStep7", getCriticalReadOutputSchema(7)],
    ["discovery", DISCOVERY_OUTPUT_SCHEMA],
    ["publicReview", PUBLIC_REVIEW_OUTPUT_SCHEMA],
    ["paperCompare", PAPER_COMPARE_OUTPUT_SCHEMA],
    ["paperTool", PAPER_TOOL_OUTPUT_SCHEMA],
    ["researchBrief", RESEARCH_BRIEF_OUTPUT_SCHEMA],
    ...Object.entries(RESEARCH_WORKSPACE_OUTPUT_SCHEMAS).map(
      ([name, schema]) => [`researchWorkspace.${name}`, schema] as const,
    ),
  ] as const;

  for (const [name, schema] of schemas) {
    assert.equal(
      nativeStructuredOutputSchemaIssue(schema),
      undefined,
      `${name} must be safe to pass to a native structured-output flag`,
    );
  }
});
