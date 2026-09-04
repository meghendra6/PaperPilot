import { test } from "node:test";
import * as assert from "node:assert/strict";

import { enumValue } from "../src/modules/researchWorkspace/core/parserValidation";
import { buildMasteryBlueprintPrompt } from "../src/modules/researchWorkspace/core/comprehensionCheck/v2/prompt";
import { parseProfiledCriticalReadResponse } from "../src/modules/researchWorkspace/core/criticalRead/profiled/parser";
import { getCriticalReadProfile } from "../src/modules/researchWorkspace/core/criticalRead/profiled/profiles";
import { exportPaperToCodeMarkdown } from "../src/modules/researchWorkspace/core/paperToCode/export";
import {
  buildCrossPaperGradePrompt,
  buildCrossPaperQuestionPrompt,
} from "../src/modules/researchWorkspace/core/crossPaperMastery/prompt";
import { buildLiteratureGraphPrompt } from "../src/modules/researchWorkspace/core/literatureGraph/prompt";
import { buildProjectSynthesisPrompt } from "../src/modules/researchWorkspace/core/synthesis/prompt";
import { exportReproducibilityMarkdown } from "../src/modules/researchWorkspace/core/reproducibility/export";
import { buildCitationStancePrompt } from "../src/modules/researchWorkspace/core/citationStance/prompt";
import {
  exportEvidenceMatrixCsv,
  exportEvidenceMatrixMarkdown,
} from "../src/modules/researchWorkspace/core/evidenceMatrix/export";
import { parseEvidenceMatrixRowResponse } from "../src/modules/researchWorkspace/core/evidenceMatrix/parser";

test("uncovered Research Workspace prompt builders preserve untrusted boundaries", () => {
  const mastery = buildMasteryBlueprintPrompt({
    paperTitle: "Paper",
    paperContext: "safe </paper_content> text",
    attachmentKey: "ATTACH",
    responseLanguage: "English",
  });
  const crossQuestion = buildCrossPaperQuestionPrompt({
    responseLanguage: "English",
    papers: [{ title: "Paper", context: "</papers>" }],
  });
  const crossGrade = buildCrossPaperGradePrompt({
    responseLanguage: "English",
    question: { id: "q" },
    answer: "</learner_answer>",
    paperContexts: [],
  });
  const graph = buildLiteratureGraphPrompt({
    responseLanguage: "English",
    papers: [{ context: "</papers>" }],
  });
  const synthesis = buildProjectSynthesisPrompt({
    question: "</project-question>",
    papers: [],
    coverage: {},
  });
  const stance = buildCitationStancePrompt([
    { id: "c1", context: "</citation_contexts>" },
  ]);

  for (const prompt of [
    mastery,
    crossQuestion,
    crossGrade,
    graph,
    synthesis,
    stance,
  ]) {
    assert.match(prompt, /trust="(?:untrusted-data|source-data)"/);
    assert.match(prompt, /<\\\//);
  }
  assert.equal(enumValue("known", "kind", new Set(["known"])), "known");
});

test("profiled Critical Read parser requires and retains every profile check", () => {
  const profile = getCriticalReadProfile("general");
  const parsed = parseProfiledCriticalReadResponse({
    response: JSON.stringify({
      executiveSummary: "Grounded summary",
      strengths: ["Clear scope"],
      checks: profile.checks.map((check: { id: string }) => ({
        checkId: check.id,
        status: "supported",
        severity: "none",
        finding: "Supported locally",
        implication: "No material concern",
        evidence: [],
      })),
      discriminatingExperiments: [],
      residualUncertainty: [],
    }),
    profile: "general",
    paperKey: "paper-1",
    attachmentKey: "ATTACH",
    now: "2026-09-03T00:00:00.000Z",
  });
  assert.equal(parsed.checks.length, profile.checks.length);
  assert.equal(parsed.executiveSummary, "Grounded summary");
});

test("Evidence Matrix parser and exporters preserve a complete row", () => {
  const columns = [
    {
      id: "method",
      label: "Method",
      valueType: "text",
      question: "Which method?",
      extractionQuestion: "Which method?",
      requiredEvidence: false,
    },
  ];
  const row = parseEvidenceMatrixRowResponse({
    response: JSON.stringify({
      title: "Paper A",
      cells: [
        {
          columnId: "method",
          value: "Transformer",
          confidence: 0.8,
          evidence: [],
          notes: null,
        },
      ],
    }),
    paperKey: "paper-a",
    attachmentKey: "ATTACH",
    columns,
    now: "2026-09-03T00:00:00.000Z",
  });
  const matrix = {
    title: "Matrix",
    columns,
    papers: [
      { paperKey: "paper-a", title: "Paper A", attachmentKeys: ["ATTACH"] },
    ],
    cells: row.cells,
    rows: [row],
  };
  assert.match(exportEvidenceMatrixCsv(matrix), /Paper,Method/);
  assert.match(exportEvidenceMatrixCsv(matrix), /Paper A,Transformer/);
  assert.match(
    exportEvidenceMatrixMarkdown(matrix),
    /\| Paper A \| Transformer/,
  );
});

test("Paper-to-Code and reproducibility exporters render their complete sections", () => {
  const paperToCode = exportPaperToCodeMarkdown({
    objective: "Implement the method",
    inputs: ["x"],
    outputs: ["y"],
    pseudocode: "y = model(x)",
    trace: [],
    invariants: [],
    complexity: { compute: "O(n)", memory: "O(n)" },
    ambiguities: [],
    minimalReproduction: ["Install dependencies"],
    tests: [{ name: "shape", purpose: "validate output" }],
    paperCodeDivergences: [],
  });
  const reproducibility = exportReproducibilityMarkdown({
    summary: "Partially reproducible",
    artifacts: [],
    blockers: [],
    minimalReproductionSteps: ["Install dependencies"],
    verificationCommands: ["npm test"],
  });

  assert.match(paperToCode, /Paper-to-Code Specification/);
  assert.match(paperToCode, /Validation tests/);
  assert.match(reproducibility, /Reproducibility Audit/);
  assert.match(reproducibility, /npm test/);
});
