import { test } from "node:test";
import * as assert from "node:assert/strict";

import { saveCriticalReadToNote } from "../src/modules/note/criticalReadNote";
import { saveDiscoveryToNote } from "../src/modules/note/discoveryNote";
import { savePaperArtifactToNote } from "../src/modules/note/paperArtifactNote";
import { buildInitialCriticalReadState } from "../src/modules/criticalRead/workflow";
import { parseDiscoveryResult } from "../src/modules/discovery/parser";

function installZoteroStub() {
  const notes: Array<{
    libraryID?: number;
    parentID?: number;
    note?: string;
    setNote(value: string): void;
    saveTx(): Promise<void>;
  }> = [];
  class Note {
    libraryID?: number;
    parentID?: number;
    note?: string;
    constructor(type: string) {
      assert.equal(type, "note");
      notes.push(this);
    }
    setNote(value: string) {
      this.note = value;
    }
    async saveTx() {}
  }
  (globalThis as { Zotero?: unknown }).Zotero = {
    Item: Note,
    Items: { get: (id: number) => ({ id, libraryID: 1 }) },
  };
  return notes;
}

function emptyDiscovery() {
  return parseDiscoveryResult(
    JSON.stringify({
      schemaVersion: 1,
      plan: {
        concernSummary: "Concern",
        primaryField: "Systems",
        adjacentFields: [],
        venues: [
          {
            venueName: "Example Conference",
            fields: ["systems"],
            judgment: "leading",
            confidence: "high",
            basis: "Field-specific archival venue assessment.",
          },
        ],
        queries: [
          { query: "q1", family: "problem", rationale: "r1" },
          { query: "q2", family: "method", rationale: "r2" },
          { query: "q3", family: "venue", rationale: "r3" },
        ],
        scopeSummary: "Scope",
      },
      verifiedMain: [],
      otherPeerReviewed: [],
      noveltyRadar: [
        {
          candidateID: "preprint-1",
          title: "Novelty signal",
          authors: ["A. Author"],
          year: 2026,
          urls: ["https://arxiv.org/abs/2601.00001"],
          providerIDs: {},
          venueName: "arXiv",
          publicationClass: "preprint_only",
          publicationEvidence: [],
          evidenceConfidence: "none",
          leadingVenueAssessment: {
            venueName: "arXiv",
            fields: ["systems"],
            judgment: "not_leading",
            confidence: "high",
            basis: "A preprint repository rather than an archival venue.",
          },
          relationship: "direct",
          relevanceReason: "Related novelty signal.",
          noveltyRelationship: "unclear",
        },
      ],
      excluded: [],
      limitations: [],
      completedAt: "2026-08-14T00:00:00.000Z",
    }),
  );
}

test("standalone PDF attachments save discovery and Critical Read as standalone notes", async () => {
  const notes = installZoteroStub();
  const item = {
    id: 7,
    libraryID: 1,
    isAttachment: () => true,
    parentItemID: false as const,
  };
  await saveDiscoveryToNote({
    item,
    paperTitle: "Standalone PDF",
    discovery: emptyDiscovery(),
  });
  await saveCriticalReadToNote({
    item,
    paperTitle: "Standalone PDF",
    state: buildInitialCriticalReadState(),
  });
  await savePaperArtifactToNote({
    item,
    card: {
      kind: "paper-compare",
      title: "Compare papers",
      summary: "Comparison summary.",
      sections: [],
      sourceLabel: "Paper Pilot QA fixture.",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  });

  assert.equal(notes.length, 3);
  assert.equal(notes[0].libraryID, 1);
  assert.equal(notes[0].parentID, undefined);
  assert.equal(notes[1].parentID, undefined);
  assert.equal(notes[2].parentID, undefined);
});

test("child attachments save notes under their bibliographic parent", async () => {
  const notes = installZoteroStub();
  const item = {
    id: 7,
    libraryID: 1,
    isAttachment: () => true,
    parentItemID: 42,
  };
  await saveDiscoveryToNote({
    item,
    paperTitle: "Child PDF",
    discovery: emptyDiscovery(),
  });
  await savePaperArtifactToNote({
    item,
    card: {
      kind: "paper-compare",
      title: "Compare papers",
      summary: "Comparison summary.",
      sections: [],
      sourceLabel: "Paper Pilot QA fixture.",
      updatedAt: "2026-08-14T00:00:00.000Z",
    },
  });
  assert.equal(notes[0].parentID, 42);
  assert.equal(notes[1].parentID, 42);
});
