import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildResearchWorkspaceZoteroSyncPreview,
  fingerprintResearchWorkspaceZoteroSyncApprovalToken,
  fingerprintResearchWorkspaceZoteroSyncPreview,
  type ResearchWorkspaceZoteroSyncReceipt,
} from "../src/modules/researchWorkspace/zoteroSync";
import { createResearchWorkspaceZoteroSyncRuntime } from "../src/modules/researchWorkspace/zoteroSyncRuntime";
import type { ResearchWorkspaceSourceRecord } from "../src/modules/researchWorkspace/persistence/contracts";

function source(itemKey: string): ResearchWorkspaceSourceRecord {
  return {
    sourceID: `zotero:1:${itemKey}:PDF-${itemKey}`,
    identity: {
      libraryID: 1,
      itemKey,
      attachmentKey: `PDF-${itemKey}`,
      standaloneAttachment: false,
    },
    title: `Paper ${itemKey}`,
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: "2026-08-30T04:00:00.000Z",
  };
}

interface FakeItemState {
  id: number;
  libraryID: number;
  key: string;
  version: number;
  kind: "regular" | "attachment";
  collections: number[];
  tags: string[];
  saveOptions: unknown[];
}

function fakeZotero(options: { withTransaction?: boolean } = {}) {
  const selectedCollectionID = 201;
  const preexistingCollectionID = 202;
  const laterCollectionID = 203;
  const states = new Map<string, FakeItemState>();
  const itemKey = (libraryID: number, key: string) => `${libraryID}:${key}`;
  const regular: FakeItemState = {
    id: 101,
    libraryID: 1,
    key: "ITEM-A",
    version: 7,
    kind: "regular",
    collections: [preexistingCollectionID],
    tags: ["preexisting-tag"],
    saveOptions: [],
  };
  const attachment: FakeItemState = {
    id: 102,
    libraryID: 1,
    key: "ATTACHMENT-A",
    version: 2,
    kind: "attachment",
    collections: [],
    tags: [],
    saveOptions: [],
  };
  states.set(itemKey(1, regular.key), regular);
  states.set(itemKey(1, attachment.key), attachment);

  const wrapItem = (state: FakeItemState) => ({
    id: state.id,
    libraryID: state.libraryID,
    key: state.key,
    get version() {
      return state.version;
    },
    isAttachment: () => state.kind === "attachment",
    isAnnotation: () => false,
    isNote: () => false,
    isRegularItem: () => state.kind === "regular",
    getCollections: () => [...state.collections],
    getTags: () => state.tags.map((tag) => ({ tag })),
    addTag(tagName: string) {
      if (!state.tags.includes(tagName)) state.tags.push(tagName);
    },
    removeTag(tagName: string) {
      state.tags = state.tags.filter((tag) => tag !== tagName);
    },
    async save(saveOptions: unknown) {
      state.saveOptions.push(saveOptions);
      state.version += 1;
    },
  });

  const collectionOptions: unknown[] = [];
  const collection = {
    id: selectedCollectionID,
    libraryID: 1,
    key: "COLLECTION-A",
    name: "Existing collection",
    version: 3,
    async addItems(itemIDs: number[], saveOptions?: unknown) {
      collectionOptions.push(saveOptions);
      for (const itemID of itemIDs) {
        const state = [...states.values()].find((entry) => entry.id === itemID);
        if (state && !state.collections.includes(selectedCollectionID)) {
          state.collections.push(selectedCollectionID);
        }
      }
    },
    async removeItems(itemIDs: number[], saveOptions?: unknown) {
      collectionOptions.push(saveOptions);
      for (const itemID of itemIDs) {
        const state = [...states.values()].find((entry) => entry.id === itemID);
        if (state) {
          state.collections = state.collections.filter(
            (id) => id !== selectedCollectionID,
          );
        }
      }
    },
  };
  const preexistingCollection = {
    id: preexistingCollectionID,
    libraryID: 1,
    key: "PREEXISTING-COLLECTION",
    name: "Preexisting collection",
    version: 1,
  };
  const laterCollection = {
    id: laterCollectionID,
    libraryID: 1,
    key: "LATER-COLLECTION",
    name: "Later collection",
    version: 1,
  };
  const collectionsByID = new Map<number, { key: string }>([
    [collection.id, collection],
    [preexistingCollection.id, preexistingCollection],
    [laterCollection.id, laterCollection],
  ]);
  let transactions = 0;
  const zotero = {
    ...(options.withTransaction === false
      ? {}
      : {
          DB: {
            async executeTransaction<T>(action: () => Promise<T>) {
              transactions += 1;
              return action();
            },
          },
        }),
    Items: {
      async getByLibraryAndKeyAsync(libraryID: number, key: string) {
        const state = states.get(itemKey(libraryID, key));
        return state ? wrapItem(state) : undefined;
      },
      async getAll(libraryID: number) {
        return [...states.values()]
          .filter((state) => state.libraryID === libraryID)
          .map(wrapItem);
      },
    },
    Collections: {
      get(id: number) {
        return collectionsByID.get(id);
      },
      async getByLibraryAndKeyAsync(libraryID: number, key: string) {
        return libraryID === 1 && key === collection.key
          ? collection
          : undefined;
      },
      getByLibrary(libraryID: number) {
        return libraryID === 1
          ? [collection, preexistingCollection, laterCollection]
          : [];
      },
    },
    Tags: {
      async getAll(libraryID: number) {
        return libraryID === 1 ? ["preexisting-tag", "reviewed"] : [];
      },
    },
  };
  return {
    zotero,
    regular,
    attachment,
    collection,
    selectedCollectionID,
    laterCollectionID,
    collectionKeys(state: FakeItemState) {
      return state.collections
        .map((id) => collectionsByID.get(id)?.key ?? `missing:${id}`)
        .sort();
    },
    collectionOptions,
    get transactions() {
      return transactions;
    },
  };
}

async function buildPreview(
  runtime: ReturnType<typeof createResearchWorkspaceZoteroSyncRuntime>,
) {
  const selection = {
    libraryID: 1,
    collectionKey: "COLLECTION-A",
    tagNames: ["reviewed"],
  };
  const observed = await runtime.observe(selection, [
    { libraryID: 1, itemKey: "ITEM-A" },
  ]);
  return buildResearchWorkspaceZoteroSyncPreview({
    projectID: "project-runtime-sync",
    membersRevision: 1,
    sources: [source("ITEM-A")],
    selection,
    observedState: observed,
    previewID: "preview-runtime-sync",
    createdAt: "2026-08-30T04:01:00.000Z",
  });
}

function committedReceipt(
  preview: Awaited<ReturnType<typeof buildPreview>>,
  applyResults: Awaited<
    ReturnType<
      ReturnType<typeof createResearchWorkspaceZoteroSyncRuntime>["apply"]
    >
  >,
): ResearchWorkspaceZoteroSyncReceipt {
  return {
    receiptID: "zotero-sync-receipt-runtime",
    projectID: preview.projectID,
    status: "committed",
    membersRevision: preview.membersRevision,
    selection: preview.selection,
    previewID: preview.previewID,
    previewFingerprint: fingerprintResearchWorkspaceZoteroSyncPreview(preview),
    approvalTokenFingerprint:
      fingerprintResearchWorkspaceZoteroSyncApprovalToken(
        preview.approvalToken,
      ),
    observedStateFingerprint: preview.observedStateFingerprint,
    plannedItems: preview.items,
    applyResults,
    createdAt: "2026-08-30T04:02:00.000Z",
    updatedAt: "2026-08-30T04:03:00.000Z",
    committedAt: "2026-08-30T04:03:00.000Z",
  };
}

test("runtime apply and undo use transactions, notifier data, and only receipt-owned additions", async () => {
  const prior = (globalThis as { Zotero?: unknown }).Zotero;
  const fake = fakeZotero();
  (globalThis as { Zotero?: unknown }).Zotero = fake.zotero;
  try {
    const runtime = createResearchWorkspaceZoteroSyncRuntime();
    const targets = await runtime.listTargets([1]);
    assert.equal(
      targets.libraries[0].collections[0].collectionKey,
      "COLLECTION-A",
    );
    assert.deepEqual(targets.libraries[0].tagNames, [
      "preexisting-tag",
      "reviewed",
    ]);

    const preview = await buildPreview(runtime);
    const applyResults = await runtime.apply(
      preview,
      "zotero-sync-receipt-runtime",
    );
    assert.equal(fake.transactions, 1);
    assert.deepEqual(fake.collectionKeys(fake.regular), [
      "COLLECTION-A",
      "PREEXISTING-COLLECTION",
    ]);
    assert.deepEqual(fake.regular.tags.sort(), ["preexisting-tag", "reviewed"]);
    assert.equal(applyResults[0].status, "applied");
    assert.equal(applyResults[0].collectionAdded, true);
    assert.deepEqual(applyResults[0].tagNamesAdded, ["reviewed"]);
    assert.equal(applyResults[0].notifierDataIncluded, true);
    assert.deepEqual(fake.collectionOptions[0], {
      skipDateModifiedUpdate: true,
      notifierData: {
        paperPilotOrigin: "research-workspace-zotero-sync",
        paperPilotSyncReceiptID: "zotero-sync-receipt-runtime",
        paperPilotSyncAction: "apply",
      },
    });
    assert.deepEqual(fake.regular.saveOptions[0], fake.collectionOptions[0]);

    // Later user-owned state must survive receipt undo.
    fake.regular.collections.push(fake.laterCollectionID);
    fake.regular.tags.push("later-tag");
    fake.regular.version += 1;
    const undoResults = await runtime.undo(
      committedReceipt(preview, applyResults),
    );
    assert.equal(fake.transactions, 2);
    assert.equal(undoResults[0].status, "undone");
    assert.equal(undoResults[0].collectionRemoved, true);
    assert.deepEqual(undoResults[0].tagNamesRemoved, ["reviewed"]);
    assert.deepEqual(fake.collectionKeys(fake.regular), [
      "LATER-COLLECTION",
      "PREEXISTING-COLLECTION",
    ]);
    assert.deepEqual(fake.regular.tags.sort(), [
      "later-tag",
      "preexisting-tag",
    ]);
    assert.deepEqual(fake.regular.saveOptions.at(-1), {
      skipDateModifiedUpdate: true,
      notifierData: {
        paperPilotOrigin: "research-workspace-zotero-sync",
        paperPilotSyncReceiptID: "zotero-sync-receipt-runtime",
        paperPilotSyncAction: "undo",
      },
    });
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = prior;
  }
});

test("runtime preserves internal tag whitespace and never materializes a normalized name", async () => {
  const fake = fakeZotero();
  (
    fake.zotero.Tags as { getAll: (libraryID: number) => Promise<string[]> }
  ).getAll = async (libraryID: number) =>
    libraryID === 1 ? ["review  tag"] : [];
  const runtime = createResearchWorkspaceZoteroSyncRuntime(fake.zotero);
  const selection = { libraryID: 1, tagNames: ["review  tag"] };
  const observed = await runtime.observe(selection, [
    { libraryID: 1, itemKey: "ITEM-A" },
  ]);
  const preview = buildResearchWorkspaceZoteroSyncPreview({
    projectID: "project-raw-tag-sync",
    membersRevision: 1,
    sources: [source("ITEM-A")],
    selection,
    observedState: observed,
    previewID: "preview-raw-tag-sync",
    createdAt: "2026-08-30T04:01:00.000Z",
  });

  await runtime.apply(preview, "receipt-raw-tag-sync");

  assert(fake.regular.tags.includes("review  tag"));
  assert.equal(fake.regular.tags.includes("review tag"), false);
  assert.throws(
    () =>
      buildResearchWorkspaceZoteroSyncPreview({
        projectID: "project-normalized-tag-sync",
        membersRevision: 1,
        sources: [source("ITEM-A")],
        selection: { libraryID: 1, tagNames: ["review tag"] },
        observedState: observed,
        previewID: "preview-normalized-tag-sync",
        createdAt: "2026-08-30T04:01:00.000Z",
      }),
    /selected Zotero tags no longer exist: review tag/,
  );
});

test("undo uses the current unrelated-state baseline instead of restoring the apply-time snapshot", async () => {
  const prior = (globalThis as { Zotero?: unknown }).Zotero;
  const fake = fakeZotero();
  (globalThis as { Zotero?: unknown }).Zotero = fake.zotero;
  try {
    const runtime = createResearchWorkspaceZoteroSyncRuntime();
    const preview = await buildPreview(runtime);
    const applyResults = await runtime.apply(
      preview,
      "zotero-sync-receipt-current-baseline",
    );

    // The user independently removes state that predated Paper Pilot and adds
    // different state before undo. Undo must not require the old snapshot to
    // reappear and must preserve the current unrelated state.
    fake.regular.collections = [
      fake.selectedCollectionID,
      fake.laterCollectionID,
    ];
    fake.regular.tags = ["reviewed", "later-tag"];
    fake.regular.version += 1;

    const undoResults = await runtime.undo(
      committedReceipt(preview, applyResults),
    );
    assert.equal(undoResults[0].status, "undone");
    assert.deepEqual(fake.collectionKeys(fake.regular), ["LATER-COLLECTION"]);
    assert.deepEqual(fake.regular.tags, ["later-tag"]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = prior;
  }
});

test("a previously settled receipt item never removes a later user re-add", async () => {
  const prior = (globalThis as { Zotero?: unknown }).Zotero;
  const fake = fakeZotero();
  (globalThis as { Zotero?: unknown }).Zotero = fake.zotero;
  try {
    const runtime = createResearchWorkspaceZoteroSyncRuntime();
    const preview = await buildPreview(runtime);
    const applyResults = await runtime.apply(
      preview,
      "zotero-sync-receipt-settled-readd",
    );
    const receipt = committedReceipt(preview, applyResults);
    const firstUndo = await runtime.undo(receipt);
    assert.equal(firstUndo[0].status, "undone");

    // A different user action later recreates the same association names.
    fake.regular.collections.push(fake.selectedCollectionID);
    fake.regular.tags.push("reviewed");
    fake.regular.version += 1;
    const settledReceipt: ResearchWorkspaceZoteroSyncReceipt = {
      ...receipt,
      status: "undone",
      undoResults: firstUndo,
      updatedAt: "2026-08-30T04:04:00.000Z",
      undoneAt: "2026-08-30T04:04:00.000Z",
    };

    const retried = await runtime.undo(settledReceipt);
    assert.deepEqual(retried, firstUndo);
    assert(fake.regular.collections.includes(fake.selectedCollectionID));
    assert(fake.regular.tags.includes("reviewed"));
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = prior;
  }
});

test("runtime rejects stale previews inside the Zotero transaction before writing", async () => {
  const prior = (globalThis as { Zotero?: unknown }).Zotero;
  const fake = fakeZotero();
  (globalThis as { Zotero?: unknown }).Zotero = fake.zotero;
  try {
    const runtime = createResearchWorkspaceZoteroSyncRuntime();
    const preview = await buildPreview(runtime);
    fake.regular.tags.push("changed-after-preview");
    await assert.rejects(
      runtime.apply(preview, "zotero-sync-receipt-stale"),
      /preview is stale/,
    );
    assert.equal(fake.transactions, 1);
    assert.equal(
      fake.regular.collections.includes(fake.selectedCollectionID),
      false,
    );
    assert.equal(fake.regular.tags.includes("reviewed"), false);
    assert.equal(fake.regular.saveOptions.length, 0);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = prior;
  }
});

test("runtime fails closed when Zotero.DB.executeTransaction is unavailable", async () => {
  const prior = (globalThis as { Zotero?: unknown }).Zotero;
  const fake = fakeZotero({ withTransaction: false });
  (globalThis as { Zotero?: unknown }).Zotero = fake.zotero;
  try {
    const runtime = createResearchWorkspaceZoteroSyncRuntime();
    const preview = await buildPreview(runtime);
    await assert.rejects(
      runtime.apply(preview, "zotero-sync-receipt-no-db"),
      /Zotero\.DB\.executeTransaction is missing/,
    );
    await assert.rejects(
      runtime.undo(
        committedReceipt(preview, [
          {
            libraryID: 1,
            itemKey: "ITEM-A",
            status: "applied",
            collectionAdded: true,
            tagNamesAdded: ["reviewed"],
            afterCollectionKeys: ["COLLECTION-A", "PREEXISTING-COLLECTION"],
            afterTagNames: ["preexisting-tag", "reviewed"],
            versionAfter: 8,
            notifierDataIncluded: true,
          },
        ]),
      ),
      /Zotero\.DB\.executeTransaction is missing/,
    );
    assert.equal(fake.transactions, 0);
    assert.equal(
      fake.regular.collections.includes(fake.selectedCollectionID),
      false,
    );
    assert.equal(fake.regular.tags.includes("reviewed"), false);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = prior;
  }
});

test("runtime preserves the Zotero DB receiver when executing a transaction", async () => {
  const fake = fakeZotero();
  let receiverMatched = false;
  const database = {
    async executeTransaction<T>(this: unknown, action: () => Promise<T>) {
      receiverMatched = this === database;
      return action();
    },
  };
  (fake.zotero as { DB?: unknown }).DB = database;
  const runtime = createResearchWorkspaceZoteroSyncRuntime(fake.zotero);
  const preview = await buildPreview(runtime);

  await runtime.apply(preview, "zotero-sync-receipt-db-receiver");

  assert.equal(receiverMatched, true);
});

test("runtime observes attachment identities as blocked and never exposes them as regular items", async () => {
  const prior = (globalThis as { Zotero?: unknown }).Zotero;
  const fake = fakeZotero();
  (globalThis as { Zotero?: unknown }).Zotero = fake.zotero;
  try {
    const runtime = createResearchWorkspaceZoteroSyncRuntime();
    const observed = await runtime.observe({ libraryID: 1, tagNames: [] }, [
      { libraryID: 1, itemKey: "ATTACHMENT-A" },
    ]);
    assert.equal(observed.items[0].itemKind, "attachment");
    assert.equal(observed.items[0].eligibleForAdditiveSync, false);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = prior;
  }
});
