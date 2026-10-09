import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  canRerunResearchWorkspaceArtifact,
  planResearchWorkspaceArtifactRerun,
} from "../src/modules/researchWorkspace/artifactRerun";
import type { ResearchWorkspaceArtifact } from "../src/modules/researchWorkspace/persistence/contracts";

function artifact(operation: string, sourceIDs = ["zotero:1:A:PA"]) {
  return {
    lineage: { operation } as ResearchWorkspaceArtifact["lineage"],
    sourceIDs,
  };
}

test("stale and partial artifacts offer a rerun; complete ones do not", () => {
  assert.equal(canRerunResearchWorkspaceArtifact({ status: "stale" }), true);
  assert.equal(canRerunResearchWorkspaceArtifact({ status: "partial" }), true);
  assert.equal(
    canRerunResearchWorkspaceArtifact({ status: "complete" }),
    false,
  );
});

test("model artifacts rerun through the matching analysis button and exact sources", () => {
  const sources = ["zotero:1:A:PA", "zotero:1:B:PB"];
  assert.deepEqual(
    planResearchWorkspaceArtifactRerun(artifact("evidence-matrix", sources)),
    {
      kind: "operation",
      buttonLabel: "Evidence Matrix",
      sourceIDs: sources,
      minSources: 2,
    },
  );
  const graph = planResearchWorkspaceArtifactRerun(
    artifact("literature-graph", sources),
  );
  assert.equal(
    graph.kind === "operation" && graph.buttonLabel,
    "Relationship Graph",
  );
  const stance = planResearchWorkspaceArtifactRerun(
    artifact("citation-stance"),
  );
  assert.equal(stance.kind, "operation");
  assert.match(
    stance.kind === "operation" ? (stance.note ?? "") : "",
    /approve them again/,
  );
});

test("derived dashboards rebuild from their own panel", () => {
  assert.deepEqual(
    planResearchWorkspaceArtifactRerun(artifact("citation-reference-health")),
    {
      kind: "panel",
      panelClass: "pprw-citation-health-panel",
      buttonLabel: "Build / refresh citation health checklist",
    },
  );
});

test("reader-owned artifacts point back to the Reader", () => {
  const plan = planResearchWorkspaceArtifactRerun(
    artifact("reader-critical-read"),
  );
  assert.equal(plan.kind, "reader");
  assert.match(plan.kind === "reader" ? plan.message : "", /Revise from here/);
});
