import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildCollectionLinkedArtifactPlan,
  getCollectionLinkedArtifactEntryState,
} from "../src/modules/paperArtifactPersistence";
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

test("buildCollectionLinkedArtifactPlan packages export payload and reusable artifacts together", () => {
  const plan = buildCollectionLinkedArtifactPlan({
    sourceItemID: 101,
    sourceTitle: "Current Paper",
    collectionID: 202,
    collectionName: "Important Papers",
    cards: [sampleCard],
    exportedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(plan.exportPayload.exportKind, "collection-linked-artifact-set");
  assert.equal(plan.exportPayload.collectionID, 202);
  assert.equal(plan.reusableArtifacts.length, 1);
  assert.equal(
    plan.reusableArtifacts[0].title,
    "[Important Papers] Current Paper — Research brief",
  );
  assert.match(plan.reusableArtifacts[0].markdown, /# Research brief/);
});

test("buildCollectionLinkedArtifactPlan preserves multiple cards in both export and reusable outputs", () => {
  const second: PaperArtifactCard = {
    ...sampleCard,
    kind: "extract-limitations",
    title: "Limitations",
    summary: "Limits",
    sections: [
      {
        heading: "Risks",
        items: ["Risk 1"],
        evidence: "mixed",
      },
    ],
    searchQueries: undefined,
  };

  const plan = buildCollectionLinkedArtifactPlan({
    sourceItemID: 101,
    sourceTitle: "Current Paper",
    collectionID: 202,
    collectionName: "Important Papers",
    cards: [sampleCard, second],
    exportedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(plan.exportPayload.artifacts.length, 2);
  assert.deepEqual(
    plan.exportPayload.artifacts.map((artifact) => artifact.kind),
    ["research-brief", "extract-limitations"],
  );
  assert.equal(plan.reusableArtifacts.length, 2);
  assert.deepEqual(
    plan.reusableArtifacts.map((artifact) => artifact.title),
    [
      "[Important Papers] Current Paper — Research brief",
      "[Important Papers] Current Paper — Limitations",
    ],
  );
});

test("buildCollectionLinkedArtifactPlan omits collection hints when no collection name is provided", () => {
  const plan = buildCollectionLinkedArtifactPlan({
    sourceItemID: 101,
    sourceTitle: "Current Paper",
    collectionID: 202,
    cards: [sampleCard],
    exportedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(plan.exportPayload.collectionID, 202);
  assert.equal(plan.reusableArtifacts[0].collectionHint, undefined);
  assert.deepEqual(plan.reusableArtifacts[0].tags, [
    "paper-artifact",
    "research-brief",
  ]);
});

test("getCollectionLinkedArtifactEntryState disables persistence when there are no cards", () => {
  assert.deepEqual(
    getCollectionLinkedArtifactEntryState({
      collectionID: 202,
      cards: [],
    }),
    {
      enabled: false,
      reason: "Need at least one artifact card before saving reusable output.",
      cardCount: 0,
    },
  );
});

test("getCollectionLinkedArtifactEntryState disables persistence when no collection is selected", () => {
  assert.deepEqual(
    getCollectionLinkedArtifactEntryState({
      cards: [sampleCard],
    }),
    {
      enabled: false,
      reason:
        "Choose a collection before saving a collection-linked artifact set.",
      cardCount: 1,
    },
  );
});

test("getCollectionLinkedArtifactEntryState reports a collection-linked ready state", () => {
  assert.deepEqual(
    getCollectionLinkedArtifactEntryState({
      collectionID: 202,
      cards: [sampleCard, sampleCard],
    }),
    {
      enabled: true,
      reason: "Ready to save 2 artifacts into the selected collection.",
      cardCount: 2,
    },
  );
});
