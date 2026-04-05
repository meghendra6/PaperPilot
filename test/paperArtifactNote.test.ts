import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildPaperArtifactNoteHtml,
  savePaperArtifactSetToCollection,
  savePaperArtifactToCollection,
  savePaperArtifactToNote,
} from "../src/modules/note/paperArtifactNote";
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

test("buildPaperArtifactNoteHtml escapes HTML and preserves markdown content", () => {
  const html = buildPaperArtifactNoteHtml({
    ...sampleCard,
    title: "Research <brief>",
    summary: "Compact <summary>.",
    sourceLabel: "Grounded <carefully> in the active paper context.",
  });

  assert.match(html, /Research &lt;brief&gt;/);
  assert.match(html, /Compact &lt;summary&gt;\./);
  assert.match(
    html,
    /Grounded &lt;carefully&gt; in the active paper context\./,
  );
  assert.match(html, /Source note:/);
  assert.match(html, /# Research &lt;brief&gt;/);
  assert.match(html, /Evidence label: explicit/);
  assert.match(html, /## Suggested search queries/);
  assert.match(html, /paper workflow tooling — find follow-ups/);
});

test("savePaperArtifactToNote attaches to the parent item when called from an attachment", async () => {
  const saved: Record<string, unknown> = {};
  const parentItem = { id: 99, libraryID: 5 };

  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Items: {
      get: (id: number) => (id === 99 ? parentItem : undefined),
    },
    Item: function () {
      return {
        set libraryID(value: number) {
          saved.libraryID = value;
        },
        set parentID(value: number) {
          saved.parentID = value;
        },
        setNote(value: string) {
          saved.note = value;
        },
        async saveTx() {
          saved.saved = true;
        },
      };
    },
  };

  try {
    await savePaperArtifactToNote({
      item: {
        id: 123,
        libraryID: 5,
        isAttachment: () => true,
        parentItemID: 99,
      } as any,
      card: sampleCard,
    });

    assert.equal(saved.libraryID, 5);
    assert.equal(saved.parentID, 99);
    assert.equal(saved.saved, true);
    assert.match(String(saved.note), /Research brief/);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("savePaperArtifactToNote uses the current item when it is not an attachment", async () => {
  const saved: Record<string, unknown> = {};

  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Item: function () {
      return {
        set libraryID(value: number) {
          saved.libraryID = value;
        },
        set parentID(value: number) {
          saved.parentID = value;
        },
        setNote(value: string) {
          saved.note = value;
        },
        async saveTx() {
          saved.saved = true;
        },
      };
    },
  };

  try {
    await savePaperArtifactToNote({
      item: {
        id: 55,
        libraryID: 9,
        isAttachment: () => false,
      } as any,
      card: sampleCard,
    });

    assert.equal(saved.libraryID, 9);
    assert.equal(saved.parentID, 55);
    assert.equal(saved.saved, true);
    assert.match(String(saved.note), /Grounded in the active paper context/);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("savePaperArtifactToNote reports unavailable Zotero note APIs clearly", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  delete (globalThis as { Zotero?: unknown }).Zotero;

  try {
    await assert.rejects(
      () =>
        savePaperArtifactToNote({
          item: {
            id: 1,
            libraryID: 1,
            isAttachment: () => false,
          } as any,
          card: sampleCard,
        }),
      /Zotero note APIs are unavailable/i,
    );
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("savePaperArtifactToCollection creates a note and adds it to the chosen collection", async () => {
  const saved: Record<string, unknown> = {};
  const collectionCalls: number[][] = [];
  const collection = {
    id: 77,
    name: "Important Papers",
    parentID: 0,
    addItems: async (ids: number[]) => collectionCalls.push(ids),
  };

  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Items: {
      getAsync: async () => ({ id: 101, libraryID: 5 }),
    },
    Collections: {
      getByLibrary: () => [collection],
    },
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollection: () => collection,
      },
    }),
    Item: function () {
      return {
        id: 303,
        set libraryID(value: number) {
          saved.libraryID = value;
        },
        setNote(value: string) {
          saved.note = value;
        },
        async saveTx() {
          saved.saved = true;
        },
      };
    },
  };

  try {
    const result = await savePaperArtifactToCollection({
      item: { id: 101, libraryID: 5 } as any,
      card: sampleCard,
    });

    assert.equal((result.collection as typeof collection).id, 77);
    assert.equal(saved.libraryID, 5);
    assert.equal(saved.saved, true);
    assert.match(String(saved.note), /Research brief/);
    assert.deepEqual(collectionCalls, [[303]]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("savePaperArtifactSetToCollection packages the whole workbench into one collection-linked note", async () => {
  const saved: Record<string, unknown> = {};
  const collectionCalls: number[][] = [];
  const collection = {
    id: 77,
    name: "Important Papers",
    parentID: 0,
    addItems: async (ids: number[]) => collectionCalls.push(ids),
  };
  const secondCard: PaperArtifactCard = {
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

  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Items: {
      getAsync: async () => ({
        id: 101,
        libraryID: 5,
        getField: (field: string) =>
          field === "title" ? "Current Paper" : undefined,
      }),
    },
    Collections: {
      getByLibrary: () => [collection],
    },
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollection: () => collection,
      },
    }),
    Item: function () {
      return {
        id: 404,
        set libraryID(value: number) {
          saved.libraryID = value;
        },
        setNote(value: string) {
          saved.note = value;
        },
        async saveTx() {
          saved.saved = true;
        },
      };
    },
  };

  try {
    const result = await savePaperArtifactSetToCollection({
      item: { id: 101, libraryID: 5 } as any,
      cards: [sampleCard, secondCard],
    });

    assert.equal((result.collection as typeof collection).id, 77);
    assert.equal(saved.libraryID, 5);
    assert.equal(saved.saved, true);
    assert.deepEqual(collectionCalls, [[404]]);
    assert.match(String(saved.note), /Current Paper workspace/);
    assert.match(String(saved.note), /Current Paper — Research brief/);
    assert.match(String(saved.note), /Current Paper — Limitations/);
    assert.equal(result.plan.exportPayload.artifacts.length, 2);
    assert.equal(result.workspaceSummary.artifactCount, 2);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("savePaperArtifactSetToCollection rejects empty workbench card sets", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Item: function () {
      return {};
    },
  };

  try {
    await assert.rejects(
      () =>
        savePaperArtifactSetToCollection({
          item: { id: 101, libraryID: 5 } as any,
          cards: [],
        }),
      /Need at least one artifact card before saving reusable output/i,
    );
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});

test("savePaperArtifactToCollection reports a clear error when no collection is selected", async () => {
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    Items: {
      getAsync: async () => ({ id: 101, libraryID: 5 }),
    },
    Collections: {
      getByLibrary: () => [],
    },
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollection: () => undefined,
      },
    }),
    Item: function () {
      return {
        async saveTx() {
          throw new Error("should not save without a collection");
        },
      };
    },
  };

  try {
    await assert.rejects(
      () =>
        savePaperArtifactToCollection({
          item: { id: 101, libraryID: 5 } as any,
          card: sampleCard,
        }),
      /Select or create a Zotero collection before saving the artifact/i,
    );
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
