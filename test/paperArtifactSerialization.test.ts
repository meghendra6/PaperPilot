import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildPaperArtifactExportPayload,
  buildPaperArtifactMarkdown,
  serializePaperArtifactCard,
  serializePaperArtifactCards,
} from "../src/modules/paperArtifactSerialization";
import type { PaperArtifactCard } from "../src/modules/paperArtifacts";

const sampleCard: PaperArtifactCard = {
  kind: "research-brief",
  title: " Research brief ",
  summary: " Concise synthesis of the paper. ",
  sections: [
    {
      heading: " Contributions ",
      items: [" First contribution ", " ", "Second contribution"],
      evidence: "explicit",
    },
    {
      heading: " ",
      items: ["Should be dropped"],
      evidence: "inference",
    },
  ],
  searchQueries: [
    {
      query: " graph neural retrieval ",
      rationale: " find follow-up baselines ",
    },
    { query: " " },
  ],
  sourceLabel:
    " Grounded in the active paper context. Follow-up ideas may include inference. ",
  updatedAt: "2026-03-15T00:00:00.000Z",
};

test("serializePaperArtifactCard normalizes text and drops empty sections", () => {
  assert.deepEqual(serializePaperArtifactCard(sampleCard), {
    schemaVersion: 1,
    kind: "research-brief",
    title: "Research brief",
    summary: "Concise synthesis of the paper.",
    sections: [
      {
        heading: "Contributions",
        items: ["First contribution", "Second contribution"],
        evidence: "explicit",
      },
    ],
    searchQueries: [
      {
        query: "graph neural retrieval",
        rationale: "find follow-up baselines",
      },
    ],
    sourceLabel:
      "Grounded in the active paper context. Follow-up ideas may include inference.",
    updatedAt: "2026-03-15T00:00:00.000Z",
  });
});

test("serializePaperArtifactCards preserves multiple cards", () => {
  const second: PaperArtifactCard = {
    ...sampleCard,
    kind: "extract-limitations",
    title: "Limitations",
    summary: "Limits",
    sections: [{ heading: "Risks", items: ["Risk 1"], evidence: "mixed" }],
    searchQueries: undefined,
  };

  assert.equal(serializePaperArtifactCards([sampleCard, second]).length, 2);
  assert.equal(
    serializePaperArtifactCards([sampleCard, second])[1].kind,
    "extract-limitations",
  );
});

test("buildPaperArtifactExportPayload creates a reusable collection-linked artifact set", () => {
  const second: PaperArtifactCard = {
    ...sampleCard,
    kind: "extract-limitations",
    title: "Limitations",
    summary: "Limits",
    sections: [{ heading: "Risks", items: ["Risk 1"], evidence: "mixed" }],
    searchQueries: undefined,
  };

  assert.deepEqual(
    buildPaperArtifactExportPayload({
      sourceItemID: 101,
      collectionID: 202,
      cards: [sampleCard, second],
      exportedAt: "2026-03-15T00:00:00.000Z",
    }),
    {
      schemaVersion: 1,
      exportKind: "collection-linked-artifact-set",
      sourceItemID: 101,
      collectionID: 202,
      exportedAt: "2026-03-15T00:00:00.000Z",
      artifacts: serializePaperArtifactCards([sampleCard, second]),
    },
  );
});

test("buildPaperArtifactMarkdown creates note-friendly markdown with evidence labels", () => {
  const markdown = buildPaperArtifactMarkdown(sampleCard);

  assert.match(markdown, /^# Research brief/m);
  assert.match(markdown, /Source note:/);
  assert.match(markdown, /## Contributions/);
  assert.match(markdown, /Evidence label: explicit/);
  assert.match(markdown, /- First contribution/);
  assert.match(markdown, /## Suggested search queries/);
  assert.match(markdown, /graph neural retrieval — find follow-up baselines/);
});
