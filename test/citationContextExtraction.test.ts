import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  CITATION_CONTEXT_EXTRACTOR_VERSION,
  extractResearchWorkspaceCitationContexts,
} from "../src/modules/researchWorkspace/citationContextExtraction";
import { applyCitationStanceCorrection } from "../src/modules/researchWorkspace/core/citationStance/corrections";
import type { ResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";

function paper(
  id: string,
  patch: Partial<ResearchWorkspacePaper> = {},
): ResearchWorkspacePaper {
  return {
    sourceID: `zotero:1:ITEM-${id}:PDF-${id}`,
    paperKey: `zotero:1:ITEM-${id}:PDF-${id}`,
    libraryID: 1,
    itemKey: `ITEM-${id}`,
    itemID: id.charCodeAt(0),
    attachmentID: id.charCodeAt(0) + 100,
    attachmentKey: `PDF-${id}`,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: `fingerprint-${id}`,
    },
    title: `Paper ${id}`,
    context: `Paper ${id} context`,
    extractionQuality: "structured",
    ...patch,
  };
}

test("local citation extraction resolves numeric and author-year contexts deterministically", () => {
  const citing = paper("A", {
    title: "Citing Paper",
    structuredChunks: [
      {
        id: "body-1",
        title: "Introduction",
        text: "Prior results agree with this mechanism [1, 2]. Smith et al. (2020) used the same data. A confidence interval [0,1] is not a citation.",
        attachmentKey: "PDF-A",
        pageIndex: 2,
        sectionPath: ["Introduction"],
        metadata: { paperKey: "A", elementId: "body-1" },
      },
      {
        id: "ref-1",
        title: "References",
        text: "[1] Smith, J. (2020). Target Paper. Journal. doi:10.1234/TARGET.",
        attachmentKey: "PDF-A",
        pageIndex: 8,
        sectionPath: ["References"],
        metadata: { paperKey: "A", elementId: "ref-1" },
      },
      {
        id: "ref-2",
        title: "References",
        text: "[2] Doe, J. (2019). Other Paper. Journal.",
        attachmentKey: "PDF-A",
        pageIndex: 8,
        sectionPath: ["References"],
        metadata: { paperKey: "A", elementId: "ref-2" },
      },
    ],
  });
  const target = paper("B", {
    title: "Target Paper",
    creators: ["Jane Smith"],
    year: 2020,
    doi: "10.1234/target",
  });
  const params = {
    papers: [citing, target],
    libraryCandidates: [
      {
        id: 900,
        libraryID: 1,
        itemKey: "ITEM-OTHER",
        title: "Other Paper",
        authors: ["John Doe"],
        year: 2019,
      },
    ],
  };
  const extracted = extractResearchWorkspaceCitationContexts(params);
  const repeated = extractResearchWorkspaceCitationContexts({
    ...params,
    papers: [...params.papers].reverse(),
  });
  assert.equal(extracted.extractorVersion, CITATION_CONTEXT_EXTRACTOR_VERSION);
  assert.equal(extracted.contexts.length, 3);
  assert.equal(extracted.coverage.markersFound, 3);
  assert.equal(extracted.coverage.resolved, 3);
  assert.equal(extracted.coverage.pageLocated, 3);
  assert.equal(extracted.contexts[0].pageIndex, 2);
  assert.equal(extracted.contexts[0].resolution.method, "project-doi");
  assert.equal(extracted.contexts[1].resolution.method, "zotero-title");
  assert.match(extracted.contexts[2].exactSentence, /Smith et al\. \(2020\)/);
  assert.deepEqual(repeated, extracted);
  assert.doesNotMatch(
    extracted.contexts.map((context) => context.marker).join(" "),
    /\[0,1\]/,
  );
});

test("citation correction is append-only, revision-guarded, and payload-bound", () => {
  const payload = {
    schemaVersion: 1,
    revision: 0,
    contexts: [{ id: "context-1" }],
    results: [
      { contextId: "context-1", stance: "background", confidence: 0.7 },
    ],
    corrections: [],
  };
  const corrected = applyCitationStanceCorrection({
    payload,
    contextID: "context-1",
    stance: "contrasting",
    reason: "The citing sentence reports conflicting evidence.",
    expectedRevision: 0,
    submissionID: "submission-1",
    eventID: "event-1",
    now: new Date("2026-08-30T00:00:00.000Z"),
  });
  assert.equal(corrected.revision, 1);
  assert.ok(corrected.results);
  assert.ok(corrected.corrections);
  assert.equal(corrected.results[0].stance, "contrasting");
  assert.equal(corrected.results[0].modelStance, "background");
  assert.equal(corrected.corrections.length, 1);
  assert.equal(
    applyCitationStanceCorrection({
      payload: corrected,
      contextID: "context-1",
      stance: "contrasting",
      reason: "The citing sentence reports conflicting evidence.",
      expectedRevision: 0,
      submissionID: "submission-1",
      eventID: "event-ignored",
    }),
    corrected,
  );
  assert.throws(
    () =>
      applyCitationStanceCorrection({
        payload: corrected,
        contextID: "context-1",
        stance: "supporting",
        reason: "Different payload",
        expectedRevision: 1,
        submissionID: "submission-1",
        eventID: "event-2",
      }),
    /idempotency conflict/,
  );
  assert.throws(
    () =>
      applyCitationStanceCorrection({
        payload: corrected,
        contextID: "context-1",
        stance: "supporting",
        reason: "New correction",
        expectedRevision: 0,
        submissionID: "submission-2",
        eventID: "event-2",
      }),
    /revision conflict/,
  );
});

test("primary Citation Stance UI is local-first and has no manual JSON input", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/view.ts"),
    "utf8",
  );
  assert.match(source, /Extract citation contexts locally/);
  assert.match(source, /reviewed the extracted snippets and approve/);
  assert.match(source, /Analyze approved snippets/);
  assert.doesNotMatch(source, /JSON array:.*citingPaperKey/);
  assert.doesNotMatch(source, /JSON\.parse\(citationInput\.value\)/);
});
