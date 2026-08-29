import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createResearchWorkspaceArtifactView,
  createResearchWorkspacePublicPayload,
  renderResearchWorkspaceArtifactValue,
} from "../src/modules/researchWorkspace/artifactRenderer";

class FakeClassList {
  constructor(private readonly owner: FakeElement) {}

  add(...tokens: string[]) {
    const classes = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const token of tokens) classes.add(token);
    this.owner.className = [...classes].join(" ");
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList(this);
  className = "";
  textContent = "";
  type = "";
  scope = "";

  constructor(readonly tagName: string) {}

  get childElementCount() {
    return this.children.length;
  }

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }

  addEventListener() {}
}

class FakeDocument {
  createElementNS(_namespace: string, tag: string) {
    return new FakeElement(tag);
  }
}

function tags(root: FakeElement): string[] {
  return [root.tagName, ...root.children.flatMap(tags)];
}

function renderedText(root: FakeElement): string {
  return [root.textContent, ...root.children.map(renderedText)].join(" ");
}

test("Evidence Matrix view preserves columns, rows, coverage, and cell evidence", () => {
  const view = createResearchWorkspaceArtifactView(
    {
      matrix: {
        columns: [
          { id: "method", label: "Method" },
          { id: "result", label: "Primary result" },
        ],
        rows: [
          {
            paperKey: "SOURCE-1",
            title: "Paper One",
            cells: [
              {
                columnId: "method",
                displayValue: "Method A",
                status: "extracted",
                confidence: 0.8,
                evidence: [
                  {
                    sourceID: "SOURCE-1",
                    attachmentKey: "PDF-1",
                    pageIndex: 2,
                    verification: { status: "verified" },
                  },
                ],
              },
            ],
          },
        ],
      },
      coverage: {
        extractionCoverage: 0.5,
        evidenceCoverage: 1,
        requiredEvidenceCoverage: 0.5,
      },
    },
    "evidence-matrix",
  );
  assert.equal(view.kind, "matrix");
  if (view.kind !== "matrix") return;
  assert.deepEqual(
    view.columns.map((column) => column.label),
    ["Method", "Primary result"],
  );
  assert.equal(view.rows[0].cells[0].evidence[0].status, "verified");
  assert.equal(view.coverage?.extraction, 0.5);

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    {
      matrix: {
        columns: [{ id: "method", label: "Method" }],
        rows: [
          {
            paperKey: "SOURCE-1",
            title: "Paper One",
            cells: [
              {
                columnId: "method",
                value: "Method A",
                status: "extracted",
                evidence: [],
              },
            ],
          },
        ],
      },
    },
    { artifactType: "evidence-matrix" },
  ) as unknown as FakeElement;
  assert(tags(rendered).includes("table"));
  assert(!tags(rendered).includes("pre"));
});

test("Relationship Graph view distinguishes verified and inferred edges", () => {
  const view = createResearchWorkspaceArtifactView(
    {
      nodes: [
        { id: "a", label: "Paper A" },
        { id: "b", label: "Paper B" },
        { id: "m", label: "Method" },
      ],
      edges: [
        {
          id: "verified",
          source: "a",
          target: "b",
          kind: "extends",
          provenance: "local-evidence",
          evidence: [],
        },
        {
          id: "inferred",
          source: "a",
          target: "m",
          kind: "uses",
          provenance: "inferred",
          evidence: [],
        },
      ],
    },
    "relationship-graph",
  );
  assert.equal(view.kind, "graph");
  if (view.kind !== "graph") return;
  assert.equal(view.nodeCount, 3);
  assert.equal(view.verifiedEdgeCount, 1);
  assert.equal(view.inferredEdgeCount, 1);
  assert.equal(view.edges[0].source, "Paper A");
});

test("Project synthesis view exposes coverage, evidence groups, and warnings", () => {
  const view = createResearchWorkspaceArtifactView(
    {
      answer: "The methods agree on the main mechanism.",
      claims: [
        {
          statement: "Shared mechanism",
          support: "verified",
          sourceIDs: ["S1", "S2"],
          evidence: [],
        },
      ],
      agreements: [],
      contradictions: [
        {
          statement: "Evaluation scope differs",
          support: "inferred",
          sourceIDs: ["S1", "S2"],
          evidence: [],
        },
      ],
      unresolvedUncertainty: ["No common benchmark"],
      freshnessWarnings: ["Paper S2 changed"],
      coverage: {
        analyzedSources: 2,
        totalProjectSources: 3,
        excludedSources: [{ sourceID: "S3", reason: "Not in snapshot" }],
        contextPlan: { insufficientCoverage: true },
      },
    },
    "synthesis",
  );
  assert.equal(view.kind, "synthesis");
  if (view.kind !== "synthesis") return;
  assert.equal(view.groups.length, 2);
  assert.equal(view.coverage?.excludedSources, 1);
  assert.equal(view.coverage?.insufficient, true);
  assert.deepEqual(view.freshnessWarnings, ["Paper S2 changed"]);
});

test("Cross-paper mastery renders learner progress without leaking an unanswered rubric", () => {
  const payload = {
    session: {
      schemaVersion: 2,
      revision: 1,
      state: "awaiting-answer",
      sourceSnapshot: [{ sourceID: "S1" }, { sourceID: "S2" }],
      questions: [
        {
          id: "Q1",
          prompt: "Compare the mechanisms.",
          mode: "compare",
          difficulty: "advanced",
          paperKeys: ["S1", "S2"],
          rubric: [
            {
              id: "mechanism",
              expectedClaims: ["HIDDEN EXPECTED CLAIM"],
            },
          ],
          criteria: [{ requiredClaims: ["HIDDEN REQUIRED CLAIM"] }],
        },
      ],
      attempts: [],
    },
    question: {
      id: "Q1",
      prompt: "Compare the mechanisms.",
      mode: "compare",
      difficulty: "advanced",
      paperKeys: ["S1", "S2"],
      rubric: [{ expectedClaims: ["HIDDEN EXPECTED CLAIM"] }],
    },
    summary: {
      answerQuality: 0.75,
      calibration: 0.85,
      conceptCoverage: 0.5,
      openMisconceptions: ["Boundary condition"],
      nextReviewAt: "2026-09-01T00:00:00.000Z",
    },
  };
  const view = createResearchWorkspaceArtifactView(
    payload,
    "cross-paper-mastery",
  );
  assert.equal(view.kind, "mastery");
  if (view.kind !== "mastery") return;
  assert.equal(view.currentQuestion?.prompt, "Compare the mechanisms.");
  assert.equal(view.sourceCount, 2);

  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    payload,
    { artifactType: "cross-paper-mastery" },
  ) as unknown as FakeElement;
  const visibleText = renderedText(rendered);
  assert.match(visibleText, /Compare the mechanisms/);
  assert.doesNotMatch(
    visibleText,
    /HIDDEN EXPECTED CLAIM|HIDDEN REQUIRED CLAIM/,
  );

  const exported = createResearchWorkspacePublicPayload(
    payload,
    "cross-paper-mastery",
  ) as typeof payload;
  assert.equal(exported.session.questions[0].rubric, undefined);
  assert.equal(exported.session.questions[0].criteria, undefined);
  assert.equal(exported.question.rubric, undefined);
});

test("Citation view exposes exact sentence, local page, resolution, and stance limits", () => {
  const value = {
    contexts: [
      {
        id: "C1",
        exactSentence: "Paper A reports a conflicting outcome [2].",
        context: "Before. Paper A reports a conflicting outcome [2]. After.",
        marker: "[2]",
        pageIndex: 4,
        reference: { raw: "Doe (2020). Paper B." },
        resolution: {
          status: "resolved",
          method: "project-title",
          title: "Paper B",
        },
        evidence: [],
      },
    ],
    results: [
      {
        contextId: "C1",
        stance: "contrasting",
        confidence: 0.8,
        rationale: "The outcome conflicts.",
        limitations: ["One local sentence"],
      },
    ],
    coverage: {
      sourcesAnalyzed: 2,
      contextsExtracted: 1,
      resolved: 1,
      ambiguous: 0,
      unresolved: 0,
      pageLocated: 1,
      submittedToModel: 1,
      analyzedContexts: 1,
      limitations: [],
    },
    corrections: [],
  };
  const view = createResearchWorkspaceArtifactView(value, "citation-stance");
  assert.equal(view.kind, "citation");
  if (view.kind !== "citation") return;
  assert.equal(view.rows[0].pageIndex, 4);
  assert.equal(view.rows[0].resolutionStatus, "resolved");
  assert.equal(view.rows[0].stance, "contrasting");
  const rendered = renderResearchWorkspaceArtifactValue(
    new FakeDocument() as unknown as Document,
    value,
    { artifactType: "citation-stance" },
  ) as unknown as FakeElement;
  assert.match(renderedText(rendered), /Page 5/);
  assert.match(renderedText(rendered), /review signal, not a verdict/i);
});

test("Research Workspace result surfaces no longer render raw JSON", () => {
  const viewSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/view.ts"),
    "utf8",
  );
  const projectSource = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/projectWindowView.ts"),
    "utf8",
  );
  assert.doesNotMatch(viewSource, /safeStringify|pprw-pre/);
  assert.doesNotMatch(
    projectSource,
    /JSON\.stringify\(artifact\.payload|pprw-pre/,
  );
});
