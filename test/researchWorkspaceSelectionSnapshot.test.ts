import { test } from "node:test";
import * as assert from "node:assert/strict";

import { paperWorkspaceContentCache } from "../src/modules/tools/paperWorkspaceContent";
import {
  captureResearchWorkspaceSelection,
  loadResearchWorkspaceSnapshotPapers,
} from "../src/modules/researchWorkspace/selectionSnapshot";

function parent(params: {
  id: number;
  key: string;
  title: string;
  attachments: number[];
}) {
  return {
    id: params.id,
    key: params.key,
    libraryID: 7,
    isAttachment: () => false,
    getAttachments: () => [...params.attachments],
    getField: (field: string) => (field === "title" ? params.title : ""),
  };
}

function attachment(params: {
  id: number;
  key: string;
  parentItemID: number;
  text?: string;
}) {
  return {
    id: params.id,
    key: params.key,
    libraryID: 7,
    parentItemID: params.parentItemID,
    version: 1,
    attachmentContentType: "application/pdf",
    attachmentText: params.text ?? `Text for ${params.key}`,
    isAttachment: () => true,
    isPDFAttachment: () => true,
    getFilePathAsync: async () => undefined,
    getField: (field: string) =>
      field === "dateModified" ? "2026-08-29 00:00:00" : "",
  };
}

function withZoteroItems(items: Map<number, any>) {
  const globalRecord = globalThis as typeof globalThis & { Zotero?: any };
  const previous = globalRecord.Zotero;
  globalRecord.Zotero = {
    Items: {
      get: (id: number) => items.get(Number(id)),
      getAsync: async (id: number) => items.get(Number(id)),
    },
  };
  return () => {
    if (previous === undefined) delete globalRecord.Zotero;
    else globalRecord.Zotero = previous;
  };
}

test("zero selection captures an immutable workspace-home snapshot", async () => {
  const restore = withZoteroItems(new Map());
  try {
    const snapshot = await captureResearchWorkspaceSelection({
      items: [],
      origin: "tools-menu",
      now: "2026-08-29T00:00:00.000Z",
    });
    assert.equal(snapshot.mode, "home");
    assert.equal(snapshot.selectedCount, 0);
    assert.deepEqual(snapshot.candidates, []);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.candidates), true);
    assert.equal(Object.isFrozen(snapshot.skipped), true);
  } finally {
    restore();
  }
});

test("captured exact PDFs do not change when the live selection mutates", async () => {
  const paperA = parent({
    id: 10,
    key: "PAPER-A",
    title: "Paper A",
    attachments: [11],
  });
  const pdfA = attachment({ id: 11, key: "PDF-A", parentItemID: 10 });
  const paperB = parent({
    id: 20,
    key: "PAPER-B",
    title: "Paper B",
    attachments: [21],
  });
  const pdfB = attachment({ id: 21, key: "PDF-B", parentItemID: 20 });
  const items = new Map<number, any>([
    [10, paperA],
    [11, pdfA],
    [20, paperB],
    [21, pdfB],
  ]);
  const restore = withZoteroItems(items);
  try {
    const liveSelection = [pdfA, paperB];
    const capture = captureResearchWorkspaceSelection({
      items: liveSelection,
      origin: "item-context-menu",
    });
    liveSelection.splice(0, liveSelection.length, pdfB);
    const snapshot = await capture;

    assert.equal(snapshot.mode, "multi");
    assert.equal(snapshot.selectedCount, 2);
    assert.deepEqual(
      snapshot.candidates.map((entry) => entry.attachmentID),
      [11, 21],
    );
    assert.deepEqual(
      snapshot.candidates.map((entry) => entry.sourceID),
      ["zotero:7:PAPER-A:PDF-A", "zotero:7:PAPER-B:PDF-B"],
    );
    assert.equal(Object.isFrozen(snapshot.candidates[0]), true);
  } finally {
    restore();
  }
});

test("ambiguous, duplicate, and excess rows preserve explicit skip reasons", async () => {
  const ambiguous = parent({
    id: 30,
    key: "AMBIGUOUS",
    title: "Ambiguous",
    attachments: [31, 32],
  });
  const pdfA = attachment({ id: 31, key: "PDF-31", parentItemID: 30 });
  const pdfB = attachment({ id: 32, key: "PDF-32", parentItemID: 30 });
  const single = parent({
    id: 40,
    key: "SINGLE",
    title: "Single",
    attachments: [41],
  });
  const pdfSingle = attachment({ id: 41, key: "PDF-41", parentItemID: 40 });
  const extra = parent({
    id: 50,
    key: "EXTRA",
    title: "Extra",
    attachments: [51],
  });
  const pdfExtra = attachment({ id: 51, key: "PDF-51", parentItemID: 50 });
  const items = new Map<number, any>([
    [30, ambiguous],
    [31, pdfA],
    [32, pdfB],
    [40, single],
    [41, pdfSingle],
    [50, extra],
    [51, pdfExtra],
  ]);
  const restore = withZoteroItems(items);
  try {
    const snapshot = await captureResearchWorkspaceSelection({
      items: [ambiguous, single, pdfSingle, extra],
      limit: 3,
    });
    assert.equal(snapshot.mode, "single");
    assert.equal(snapshot.candidates[0].attachmentID, 41);
    assert.deepEqual(
      snapshot.skipped.map((entry) => entry.code),
      ["ambiguous-pdf", "duplicate-source", "selection-limit"],
    );
    assert.match(snapshot.skipped[0].reason, /exact PDF attachment row/);
  } finally {
    restore();
  }
});

test("snapshot loading resolves the captured attachment ID instead of live selection", async () => {
  const paperA = parent({
    id: 60,
    key: "PAPER-60",
    title: "Captured Paper",
    attachments: [61],
  });
  const pdfA = attachment({
    id: 61,
    key: "PDF-61",
    parentItemID: 60,
    text: "Captured attachment contents",
  });
  const items = new Map<number, any>([
    [60, paperA],
    [61, pdfA],
  ]);
  const restore = withZoteroItems(items);
  paperWorkspaceContentCache.clearCache();
  try {
    const snapshot = await captureResearchWorkspaceSelection({
      items: [paperA],
    });
    const loaded = await loadResearchWorkspaceSnapshotPapers(snapshot);
    assert.equal(loaded.papers.length, 1);
    assert.equal(loaded.papers[0].attachmentID, 61);
    assert.equal(loaded.papers[0].context, "Captured attachment contents");
    assert.deepEqual(loaded.skipped, []);
  } finally {
    paperWorkspaceContentCache.clearCache();
    restore();
  }
});
