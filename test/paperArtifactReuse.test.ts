import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildReusableArtifactPayload,
  buildReusableArtifactSaveRecord,
  buildReusableArtifactTitle,
} from "../src/modules/paperArtifactReuse";
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

test("buildReusableArtifactTitle includes collection context when available", () => {
  assert.equal(
    buildReusableArtifactTitle({
      parentTitle: "Current Paper",
      cardTitle: "Research brief",
      collectionName: "Important Papers",
    }),
    "[Important Papers] Current Paper — Research brief",
  );
});

test("buildReusableArtifactTitle normalizes whitespace and falls back safely", () => {
  assert.equal(
    buildReusableArtifactTitle({
      parentTitle: "   ",
      cardTitle: "   ",
      collectionName: "  Reader Queue  ",
    }),
    "[Reader Queue] Untitled paper — Artifact",
  );
});

test("buildReusableArtifactPayload packages note-friendly reusable artifact data", () => {
  const payload = buildReusableArtifactPayload({
    parentTitle: "Current Paper",
    card: sampleCard,
    collectionName: "Important Papers",
  });

  assert.equal(
    payload.title,
    "[Important Papers] Current Paper — Research brief",
  );
  assert.equal(payload.summary, "Compact summary.");
  assert.equal(payload.collectionHint, "Important Papers");
  assert.match(payload.markdown, /# Research brief/);
  assert.match(payload.markdown, /paper workflow tooling — find follow-ups/);
  assert.deepEqual(payload.tags, [
    "paper-artifact",
    "research-brief",
    "collection:important papers",
  ]);
});

test("buildReusableArtifactPayload omits collection-specific fields when no collection is provided", () => {
  const payload = buildReusableArtifactPayload({
    parentTitle: " Current Paper ",
    card: {
      ...sampleCard,
      summary: "  Compact summary.  ",
    },
  });

  assert.equal(payload.title, "Current Paper — Research brief");
  assert.equal(payload.summary, "Compact summary.");
  assert.equal(payload.collectionHint, undefined);
  assert.deepEqual(payload.tags, ["paper-artifact", "research-brief"]);
});

test("buildReusableArtifactSaveRecord packages a collection-linked reusable save record", () => {
  const record = buildReusableArtifactSaveRecord({
    sourceItemID: 101,
    parentTitle: "Current Paper",
    card: sampleCard,
    collectionID: 202,
    collectionName: "Important Papers",
    savedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.deepEqual(record, {
    schemaVersion: 1,
    sourceItemID: 101,
    collectionID: 202,
    savedAt: "2026-03-15T00:00:00.000Z",
    payload: {
      title: "[Important Papers] Current Paper — Research brief",
      markdown: record.payload.markdown,
      summary: "Compact summary.",
      tags: ["paper-artifact", "research-brief", "collection:important papers"],
      collectionHint: "Important Papers",
    },
  });
  assert.match(record.payload.markdown, /# Research brief/);
});

test("buildReusableArtifactSaveRecord omits collection id when persisting outside a collection", () => {
  const record = buildReusableArtifactSaveRecord({
    sourceItemID: 101,
    parentTitle: "Current Paper",
    card: sampleCard,
    savedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(record.collectionID, undefined);
  assert.equal(record.payload.collectionHint, undefined);
  assert.deepEqual(record.payload.tags, ["paper-artifact", "research-brief"]);
});
