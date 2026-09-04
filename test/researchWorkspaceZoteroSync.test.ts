import { test } from "node:test";
import * as assert from "node:assert/strict";

import type { ResearchWorkspaceSourceRecord } from "../src/modules/researchWorkspace/persistence/contracts";
import {
  RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION,
  buildResearchWorkspaceZoteroSyncPreview,
  fingerprintResearchWorkspaceZoteroSyncPreview,
  parseResearchWorkspaceZoteroSyncReceiptFile,
  verifyResearchWorkspaceZoteroSyncApproval,
  type ResearchWorkspaceZoteroSyncObservedState,
  type ResearchWorkspaceZoteroSyncReceiptFile,
} from "../src/modules/researchWorkspace/zoteroSync";

function source(
  itemKey: string,
  libraryID = 1,
  attachmentKey = `PDF-${itemKey}`,
): ResearchWorkspaceSourceRecord {
  return {
    sourceID: `zotero:${libraryID}:${itemKey}:${attachmentKey}`,
    identity: {
      libraryID,
      itemKey,
      attachmentKey,
      standaloneAttachment: itemKey === attachmentKey,
    },
    title: `Paper ${itemKey}`,
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: "2026-08-30T03:00:00.000Z",
  };
}

function observedState(
  items: ResearchWorkspaceZoteroSyncObservedState["items"],
): ResearchWorkspaceZoteroSyncObservedState {
  return {
    libraryID: 1,
    collection: {
      libraryID: 1,
      collectionKey: "COLLECTION-A",
      name: "Existing collection",
      version: 4,
    },
    existingTagNames: ["reviewed", "systematic"],
    items,
  };
}

function regularObserved(
  itemKey: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    libraryID: 1,
    itemKey,
    itemKind: "regular-item" as const,
    eligibleForAdditiveSync: true,
    available: true,
    version: 10,
    collectionKeys: [],
    tagNames: [],
    ...overrides,
  };
}

function preview() {
  return buildResearchWorkspaceZoteroSyncPreview({
    projectID: "project-sync",
    membersRevision: 8,
    sources: [source("ITEM-A"), source("ITEM-B")],
    selection: {
      libraryID: 1,
      collectionKey: "COLLECTION-A",
      tagNames: ["reviewed"],
    },
    observedState: observedState([
      regularObserved("ITEM-A"),
      regularObserved("ITEM-B", {
        collectionKeys: ["COLLECTION-A"],
        tagNames: ["reviewed"],
      }),
    ]),
    previewID: "preview-sync-1",
    createdAt: "2026-08-30T03:01:00.000Z",
  });
}

test("safe Zotero sync creates a full additive-only preview for stable identities", () => {
  const first = preview();
  const second = preview();

  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].status, "additive");
  assert.equal(first.items[0].addCollection, true);
  assert.deepEqual(first.items[0].addTagNames, ["reviewed"]);
  assert.equal(first.items[1].status, "no-op");
  assert.deepEqual(first.summary, {
    totalItems: 2,
    additiveItems: 1,
    noOpItems: 1,
    blockedItems: 0,
    collectionAdditions: 1,
    tagAdditions: 1,
  });
  assert.equal(first.collection?.collectionKey, "COLLECTION-A");
  assert.equal(first.approvalToken, second.approvalToken);
  assert.equal(
    fingerprintResearchWorkspaceZoteroSyncPreview(first),
    fingerprintResearchWorkspaceZoteroSyncPreview(second),
  );
});

test("approval tokens are bound to the complete preview and stale mutations are rejected", () => {
  const approved = preview();
  assert.equal(
    verifyResearchWorkspaceZoteroSyncApproval(approved, approved.approvalToken),
    approved.approvalToken,
  );
  assert.throws(
    () =>
      verifyResearchWorkspaceZoteroSyncApproval(
        approved,
        "zotero-sync-approval:wrong",
      ),
    /not bound to this exact sync preview/,
  );

  const changed = structuredClone(approved);
  changed.items[0].addTagNames.push("systematic");
  assert.throws(
    () =>
      verifyResearchWorkspaceZoteroSyncApproval(
        changed,
        approved.approvalToken,
      ),
    /not bound to this exact sync preview/,
  );
});

test("cross-library, attachment, missing, and unknown identities stay blocked", () => {
  const result = buildResearchWorkspaceZoteroSyncPreview({
    projectID: "project-blocked-sync",
    membersRevision: 1,
    sources: [
      source("CROSS-LIBRARY", 2),
      source("ATTACHMENT", 1, "ATTACHMENT"),
      source("MISSING"),
      source("UNKNOWN"),
    ],
    selection: { libraryID: 1, tagNames: ["reviewed"] },
    observedState: {
      libraryID: 1,
      existingTagNames: ["reviewed"],
      items: [
        {
          libraryID: 1,
          itemKey: "ATTACHMENT",
          itemKind: "attachment",
          eligibleForAdditiveSync: false,
          available: true,
          version: 2,
          collectionKeys: [],
          tagNames: [],
        },
        {
          libraryID: 1,
          itemKey: "MISSING",
          itemKind: "unknown",
          eligibleForAdditiveSync: false,
          available: false,
          collectionKeys: [],
          tagNames: [],
        },
        {
          libraryID: 1,
          itemKey: "UNKNOWN",
          itemKind: "unknown",
          eligibleForAdditiveSync: false,
          available: true,
          collectionKeys: [],
          tagNames: [],
        },
      ],
    },
    previewID: "preview-blocked",
    createdAt: "2026-08-30T03:02:00.000Z",
  });

  assert.equal(result.summary.blockedItems, 4);
  assert.equal(result.summary.collectionAdditions, 0);
  assert.equal(result.summary.tagAdditions, 0);
  assert(
    result.items.every(
      (item) =>
        item.status === "blocked" &&
        !item.addCollection &&
        item.addTagNames.length === 0,
    ),
  );
});

test("preview rejects collection and tag targets that do not already exist", () => {
  const base = {
    projectID: "project-existing-targets",
    membersRevision: 1,
    sources: [source("ITEM-A")],
    previewID: "preview-existing-targets",
    createdAt: "2026-08-30T03:02:30.000Z",
  };
  assert.throws(
    () =>
      buildResearchWorkspaceZoteroSyncPreview({
        ...base,
        selection: { libraryID: 1, tagNames: ["missing-tag"] },
        observedState: {
          libraryID: 1,
          existingTagNames: ["reviewed"],
          items: [regularObserved("ITEM-A")],
        },
      }),
    /tags no longer exist/,
  );
  assert.throws(
    () =>
      buildResearchWorkspaceZoteroSyncPreview({
        ...base,
        selection: {
          libraryID: 1,
          collectionKey: "MISSING-COLLECTION",
          tagNames: [],
        },
        observedState: {
          libraryID: 1,
          existingTagNames: [],
          items: [regularObserved("ITEM-A")],
        },
      }),
    /collection is unavailable/,
  );
});

test("receipt parsing accepts exact per-item ownership and rejects overclaims", () => {
  const approved = preview();
  const receipt: ResearchWorkspaceZoteroSyncReceiptFile = {
    schemaVersion: RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION,
    revision: 2,
    receipt: {
      receiptID: "zotero-sync-receipt-1",
      projectID: approved.projectID,
      status: "committed",
      membersRevision: approved.membersRevision,
      selection: approved.selection,
      previewID: approved.previewID,
      previewFingerprint:
        fingerprintResearchWorkspaceZoteroSyncPreview(approved),
      approvalTokenFingerprint: "approval-token-fingerprint",
      observedStateFingerprint: approved.observedStateFingerprint,
      plannedItems: approved.items,
      applyResults: approved.items.map((item) => ({
        libraryID: item.libraryID,
        itemKey: item.itemKey,
        status:
          item.status === "additive"
            ? ("applied" as const)
            : item.status === "blocked"
              ? ("blocked" as const)
              : ("no-op" as const),
        collectionAdded: item.addCollection,
        tagNamesAdded: [...item.addTagNames],
        afterCollectionKeys: [
          ...item.beforeCollectionKeys,
          ...(item.addCollection && approved.selection.collectionKey
            ? [approved.selection.collectionKey]
            : []),
        ].sort(),
        afterTagNames: [...item.beforeTagNames, ...item.addTagNames].sort(),
        notifierDataIncluded: item.status === "additive",
      })),
      createdAt: "2026-08-30T03:03:00.000Z",
      updatedAt: "2026-08-30T03:04:00.000Z",
      committedAt: "2026-08-30T03:04:00.000Z",
    },
  };
  assert.deepEqual(
    parseResearchWorkspaceZoteroSyncReceiptFile(structuredClone(receipt)),
    receipt,
  );

  const overclaimedTag = structuredClone(receipt);
  overclaimedTag.receipt.applyResults![0].tagNamesAdded.push("unowned-tag");
  assert.throws(
    () => parseResearchWorkspaceZoteroSyncReceiptFile(overclaimedTag),
    /does not match its approved additions/,
  );

  const overclaimedCollection = structuredClone(receipt);
  overclaimedCollection.receipt.applyResults![1].collectionAdded = true;
  assert.throws(
    () => parseResearchWorkspaceZoteroSyncReceiptFile(overclaimedCollection),
    /status does not match its additions/,
  );

  const missingResult = structuredClone(receipt);
  missingResult.receipt.applyResults!.pop();
  assert.throws(
    () => parseResearchWorkspaceZoteroSyncReceiptFile(missingResult),
    /one result for every preview item/,
  );

  const falseUndone = structuredClone(receipt);
  falseUndone.receipt.status = "undone";
  falseUndone.receipt.undoResults = falseUndone.receipt.applyResults!.map(
    (result) => ({
      libraryID: result.libraryID,
      itemKey: result.itemKey,
      status:
        result.collectionAdded || result.tagNamesAdded.length
          ? ("blocked" as const)
          : ("no-op" as const),
      collectionRemoved: false,
      tagNamesRemoved: [],
      notifierDataIncluded: false,
      ...(result.collectionAdded || result.tagNamesAdded.length
        ? { message: "Still present" }
        : {}),
    }),
  );
  falseUndone.receipt.undoneAt = "2026-08-30T03:05:00.000Z";
  assert.throws(
    () => parseResearchWorkspaceZoteroSyncReceiptFile(falseUndone),
    /must clear every receipt-owned addition/,
  );
});

test("failed receipts contain no fabricated ownership results", () => {
  const approved = preview();
  const failed: ResearchWorkspaceZoteroSyncReceiptFile = {
    schemaVersion: RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION,
    revision: 2,
    receipt: {
      receiptID: "zotero-sync-receipt-failed",
      projectID: approved.projectID,
      status: "failed",
      membersRevision: approved.membersRevision,
      selection: approved.selection,
      previewID: approved.previewID,
      previewFingerprint:
        fingerprintResearchWorkspaceZoteroSyncPreview(approved),
      approvalTokenFingerprint: "approval-token-fingerprint",
      observedStateFingerprint: approved.observedStateFingerprint,
      plannedItems: approved.items,
      error: "Transaction unavailable",
      createdAt: "2026-08-30T03:03:00.000Z",
      updatedAt: "2026-08-30T03:04:00.000Z",
    },
  };
  assert.deepEqual(parseResearchWorkspaceZoteroSyncReceiptFile(failed), failed);
  const invalid = structuredClone(failed);
  invalid.receipt.applyResults = [];
  assert.throws(
    () => parseResearchWorkspaceZoteroSyncReceiptFile(invalid),
    /Only committed Zotero sync receipts may own additions/,
  );
});
