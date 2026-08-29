import { test } from "node:test";
import * as assert from "node:assert/strict";

import { paperWorkspaceContentCache } from "../src/modules/tools/paperWorkspaceContent";
import { loadResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";
import {
  buildZoteroSourceID,
  createZoteroSourceIdentity,
  parseZoteroSourceID,
  sameZoteroSource,
} from "../src/modules/researchWorkspace/sourceIdentity";

test("Zotero source IDs are deterministic and library scoped", () => {
  const personal = createZoteroSourceIdentity({
    libraryID: 1,
    itemKey: "ITEM:ONE",
    attachmentKey: "ATTACH/ONE",
  });
  const group = createZoteroSourceIdentity({
    libraryID: 2,
    itemKey: "ITEM:ONE",
    attachmentKey: "ATTACH/ONE",
  });

  assert.equal(
    buildZoteroSourceID(personal),
    "zotero:1:ITEM%3AONE:ATTACH%2FONE",
  );
  assert.notEqual(buildZoteroSourceID(personal), buildZoteroSourceID(group));
  assert.equal(sameZoteroSource(personal, { ...personal }), true);
  assert.equal(sameZoteroSource(personal, group), false);
  assert.deepEqual(parseZoteroSourceID(buildZoteroSourceID(personal)), {
    libraryID: 1,
    itemKey: "ITEM:ONE",
    attachmentKey: "ATTACH/ONE",
  });
  assert.equal(parseZoteroSourceID("zotero:bad"), undefined);
});

test("Zotero source identity rejects missing or invalid stable identifiers", () => {
  assert.throws(
    () =>
      createZoteroSourceIdentity({
        libraryID: 0,
        itemKey: "ITEM",
        attachmentKey: "ATTACH",
      }),
    /positive libraryID/,
  );
  assert.throws(
    () =>
      createZoteroSourceIdentity({
        libraryID: 1,
        itemKey: " ",
        attachmentKey: "ATTACH",
      }),
    /itemKey is required/,
  );
});

test("selected child PDF extraction never falls back to the parent's first PDF", async () => {
  const parentAttachmentIDs = [11, 12];
  const parent = {
    id: 10,
    key: "PARENT",
    libraryID: 5,
    isAttachment: () => false,
    getAttachments: () => [...parentAttachmentIDs],
    getField: (field: string) =>
      field === "title" ? "Paper with two PDFs" : "",
  };
  const makeAttachment = (params: {
    id: number;
    key: string;
    text: string;
  }) => ({
    id: params.id,
    key: params.key,
    libraryID: 5,
    parentItemID: 10,
    version: 1,
    attachmentContentType: "application/pdf",
    attachmentText: params.text,
    isAttachment: () => true,
    isPDFAttachment: () => true,
    getFilePathAsync: async () => undefined,
    getField: (field: string) =>
      field === "dateModified" ? "2026-08-29 00:00:00" : "",
  });
  const attachmentA = makeAttachment({
    id: 11,
    key: "PDF-A",
    text: "Content from PDF A",
  });
  const attachmentB = makeAttachment({
    id: 12,
    key: "PDF-B",
    text: "Content from PDF B",
  });
  const items = new Map<number, any>([
    [parent.id, parent],
    [attachmentA.id, attachmentA],
    [attachmentB.id, attachmentB],
  ]);
  const globalRecord = globalThis as typeof globalThis & { Zotero?: any };
  const previousZotero = globalRecord.Zotero;
  globalRecord.Zotero = {
    Items: {
      get: (id: number) => items.get(Number(id)),
      getAsync: async (id: number) => items.get(Number(id)),
    },
  };
  paperWorkspaceContentCache.clearCache();

  try {
    const paper = await loadResearchWorkspacePaper(attachmentB);
    assert.equal(paper.context, "Content from PDF B");
    assert.equal(paper.attachmentID, 12);
    assert.equal(paper.attachmentKey, "PDF-B");
    assert.equal(paper.libraryID, 5);
    assert.equal(paper.itemKey, "PARENT");
    assert.equal(paper.sourceID, "zotero:5:PARENT:PDF-B");
    assert.equal(paper.paperKey, paper.sourceID);

    await assert.rejects(
      () => loadResearchWorkspacePaper(parent),
      /Multiple PDF attachments found/,
    );
    parentAttachmentIDs.splice(0, parentAttachmentIDs.length, 12);
    const resolvedParent = await loadResearchWorkspacePaper(parent);
    assert.equal(resolvedParent.attachmentKey, "PDF-B");
    assert.equal(resolvedParent.context, "Content from PDF B");
  } finally {
    paperWorkspaceContentCache.clearCache();
    if (previousZotero === undefined) delete globalRecord.Zotero;
    else globalRecord.Zotero = previousZotero;
  }
});
