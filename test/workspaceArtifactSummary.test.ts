import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildWorkspaceArtifactSummary } from "../src/modules/workspace/artifactSummary";

test("buildWorkspaceArtifactSummary groups reusable artifacts into a workspace-ready summary payload", () => {
  const summary = buildWorkspaceArtifactSummary({
    workspaceTitle: "  Literature Review Workspace ",
    artifacts: [
      {
        title: "[Important Papers] Current Paper — Research brief",
        markdown: "# Research brief",
        summary: "Compact summary.",
        tags: [
          "paper-artifact",
          "research-brief",
          "collection:important papers",
        ],
        collectionHint: "Important Papers",
      },
      {
        title: "[Important Papers] Current Paper — Compare papers",
        markdown: "# Compare papers",
        summary: "Compare summary.",
        tags: [
          "paper-artifact",
          "paper-compare",
          "collection:important papers",
        ],
        collectionHint: "Important Papers",
      },
    ],
  });

  assert.deepEqual(summary, {
    schemaVersion: 1,
    title: "Literature Review Workspace",
    artifactCount: 2,
    artifactTitles: [
      "[Important Papers] Current Paper — Research brief",
      "[Important Papers] Current Paper — Compare papers",
    ],
    collectionHints: ["Important Papers"],
    tags: [
      "paper-artifact",
      "research-brief",
      "collection:important papers",
      "paper-compare",
    ],
    summary: "2 artifacts · collections: Important Papers",
  });
});

test("buildWorkspaceArtifactSummary falls back cleanly for empty artifact sets", () => {
  const summary = buildWorkspaceArtifactSummary({
    workspaceTitle: "   ",
    artifacts: [],
  });

  assert.deepEqual(summary, {
    schemaVersion: 1,
    title: "Workspace artifacts",
    artifactCount: 0,
    artifactTitles: [],
    collectionHints: [],
    tags: [],
    summary: "0 artifacts",
  });
});
