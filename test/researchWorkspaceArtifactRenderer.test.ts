import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createResearchWorkspaceArtifactView,
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
