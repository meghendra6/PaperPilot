import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildWorkspaceArtifactBundle } from "../src/modules/workspace/artifactBundle";
import type { PaperArtifactCard } from "../src/modules/paperArtifacts";

const sampleCard: PaperArtifactCard = {
  kind: "research-brief",
  title: "Research brief",
  summary: "Compact summary.",
  sections: [
    {
      heading: "Contributions",
      items: ["Contribution A"],
      evidence: "explicit",
    },
  ],
  searchQueries: [
    { query: "paper workflow tooling", rationale: "find follow-ups" },
  ],
  sourceLabel: "Grounded in the active paper context.",
  updatedAt: "2026-03-15T00:00:00.000Z",
};

test("buildWorkspaceArtifactBundle assembles collection export planning with workspace summary output", () => {
  const bundle = buildWorkspaceArtifactBundle({
    workspaceTitle: " Literature Review Workspace ",
    sourceItemID: 101,
    sourceTitle: "Current Paper",
    collectionID: 202,
    collectionName: "Important Papers",
    cards: [sampleCard],
    exportedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(
    bundle.plan.exportPayload.exportKind,
    "collection-linked-artifact-set",
  );
  assert.equal(bundle.plan.reusableArtifacts.length, 1);
  assert.deepEqual(bundle.summary, {
    schemaVersion: 1,
    title: "Literature Review Workspace",
    artifactCount: 1,
    artifactTitles: ["[Important Papers] Current Paper — Research brief"],
    collectionHints: ["Important Papers"],
    tags: ["paper-artifact", "research-brief", "collection:important papers"],
    summary: "1 artifact · collections: Important Papers",
  });
});

test("buildWorkspaceArtifactBundle falls back cleanly when workspace title and collection name are absent", () => {
  const bundle = buildWorkspaceArtifactBundle({
    workspaceTitle: "   ",
    sourceItemID: 101,
    sourceTitle: "Current Paper",
    collectionID: 202,
    cards: [sampleCard],
    exportedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(bundle.summary.title, "Workspace artifacts");
  assert.deepEqual(bundle.summary.collectionHints, []);
  assert.deepEqual(bundle.summary.tags, ["paper-artifact", "research-brief"]);
});
