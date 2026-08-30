import { test } from "node:test";
import * as assert from "node:assert/strict";

import type {
  ResearchWorkspaceFileOps,
  ResearchWorkspaceSourceRecord,
} from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import {
  fingerprintResearchWorkspaceZoteroSyncApprovalToken,
  fingerprintResearchWorkspaceZoteroSyncPreview,
  type ResearchWorkspaceZoteroSyncApplyItemResult,
  type ResearchWorkspaceZoteroSyncObservedState,
  type ResearchWorkspaceZoteroSyncPreview,
  type ResearchWorkspaceZoteroSyncReceipt,
  type ResearchWorkspaceZoteroSyncUndoItemResult,
} from "../src/modules/researchWorkspace/zoteroSync";
import type { ResearchWorkspaceZoteroSyncRuntime } from "../src/modules/researchWorkspace/zoteroSyncRuntime";
import { ResearchWorkspaceZoteroSyncService } from "../src/modules/researchWorkspace/zoteroSyncService";

class MemoryFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly writes: Array<{ path: string; contents: string }> = [];

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async exists(path: string) {
    if (this.files.has(path) || this.directories.has(path)) return true;
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].some((entry) => entry.startsWith(prefix));
  }

  async readText(path: string) {
    return this.files.get(path);
  }

  async writeTextAtomic(path: string, contents: string) {
    this.writes.push({ path, contents });
    this.files.set(path, contents);
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const entry of [...this.files.keys()]) {
      if (entry === path || (options?.recursive && entry.startsWith(prefix))) {
        this.files.delete(entry);
      }
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

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
    lastResolvedAt: "2026-08-30T05:00:00.000Z",
  };
}

function setup(
  params: {
    runtimeFactory?: (
      repository: ResearchWorkspaceProjectRepository,
    ) => ResearchWorkspaceZoteroSyncRuntime;
  } = {},
) {
  const files = new MemoryFiles();
  let clock = Date.parse("2026-08-30T05:00:00.000Z");
  let id = 0;
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir: "/profile/paperpilot-research-workspace",
    fileOps: files,
    now: () => new Date(clock++),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  const runtime = params.runtimeFactory?.(repository) ?? runtimeState().runtime;
  const service = new ResearchWorkspaceZoteroSyncService(repository, {
    runtime,
    now: () => new Date(clock++),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  return { files, repository, runtime, service };
}

function runtimeState() {
  let observed: ResearchWorkspaceZoteroSyncObservedState = {
    libraryID: 1,
    collection: {
      libraryID: 1,
      collectionKey: "COLLECTION-A",
      name: "Existing collection",
      version: 2,
    },
    existingTagNames: ["reviewed"],
    items: [
      {
        libraryID: 1,
        itemKey: "ITEM-A",
        itemKind: "regular-item",
        eligibleForAdditiveSync: true,
        available: true,
        version: 4,
        collectionKeys: [],
        tagNames: [],
      },
    ],
  };
  let applyCalls = 0;
  let undoCalls = 0;
  let undoMode: "undone" | "blocked" = "undone";
  const runtime: ResearchWorkspaceZoteroSyncRuntime = {
    async listTargets() {
      return {
        libraries: [
          {
            libraryID: 1,
            collections: [observed.collection!],
            tagNames: ["reviewed"],
          },
        ],
        limitations: [],
      };
    },
    async observe() {
      return structuredClone(observed);
    },
    async apply(preview) {
      applyCalls += 1;
      return preview.items.map((item) => {
        const afterCollectionKeys = [
          ...item.beforeCollectionKeys,
          ...(item.addCollection && preview.selection.collectionKey
            ? [preview.selection.collectionKey]
            : []),
        ].sort();
        const afterTagNames = [
          ...item.beforeTagNames,
          ...item.addTagNames,
        ].sort();
        return {
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
          afterCollectionKeys,
          afterTagNames,
          versionAfter: 5,
          notifierDataIncluded: item.status === "additive",
        } satisfies ResearchWorkspaceZoteroSyncApplyItemResult;
      });
    },
    async undo(receipt) {
      undoCalls += 1;
      return (receipt.applyResults ?? []).map((result) => ({
        libraryID: result.libraryID,
        itemKey: result.itemKey,
        status: undoMode,
        collectionRemoved: undoMode === "undone" && result.collectionAdded,
        tagNamesRemoved: undoMode === "undone" ? [...result.tagNamesAdded] : [],
        notifierDataIncluded: undoMode === "undone",
        ...(undoMode === "blocked"
          ? { message: "Current state does not permit receipt-owned undo." }
          : {}),
      })) as ResearchWorkspaceZoteroSyncUndoItemResult[];
    },
  };
  return {
    runtime,
    setObserved(next: ResearchWorkspaceZoteroSyncObservedState) {
      observed = structuredClone(next);
    },
    setUndoMode(mode: "undone" | "blocked") {
      undoMode = mode;
    },
    get applyCalls() {
      return applyCalls;
    },
    get undoCalls() {
      return undoCalls;
    },
  };
}

async function createProject(
  repository: ResearchWorkspaceProjectRepository,
  projectID = "project-sync-service",
) {
  const created = await repository.createProject({
    projectID,
    name: "Safe sync service",
  });
  const paper = source("ITEM-A");
  await repository.putSource(paper);
  const members = await repository.addMembers(
    projectID,
    created.membersRevision,
    [{ sourceID: paper.sourceID }],
  );
  return { created, paper, members };
}

async function preview(
  service: ResearchWorkspaceZoteroSyncService,
  projectID = "project-sync-service",
) {
  return service.preview({
    projectID,
    selection: {
      libraryID: 1,
      collectionKey: "COLLECTION-A",
      tagNames: ["reviewed"],
    },
  });
}

test("service writes a prepared receipt before invoking the Zotero transaction", async () => {
  let runtimeApplyCalls = 0;
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: (repo) => ({
      ...state.runtime,
      async apply(syncPreview, receiptID) {
        runtimeApplyCalls += 1;
        const prepared = await repo.getZoteroSyncReceipt(
          syncPreview.projectID,
          receiptID,
        );
        assert.equal(prepared?.receipt.status, "prepared");
        assert.equal(prepared?.receipt.applyResults, undefined);
        return state.runtime.apply(syncPreview, receiptID);
      },
    }),
  });
  await createProject(repository);
  const approved = await preview(service);
  const committed = await service.apply({
    preview: approved,
    approvalToken: approved.approvalToken,
  });

  assert.equal(runtimeApplyCalls, 1);
  assert.equal(committed.receipt.status, "committed");
  assert.equal(committed.revision, 2);
  assert.equal(committed.receipt.applyResults?.[0].status, "applied");
  assert.equal(
    committed.receipt.approvalTokenFingerprint.includes(approved.approvalToken),
    false,
  );
  assert.equal(
    (await repository.listArtifacts(approved.projectID)).artifacts.length,
    0,
  );
});

test("service normalizes the exact target selection before observing Zotero", async () => {
  const state = runtimeState();
  let observedSelection:
    | ResearchWorkspaceZoteroSyncPreview["selection"]
    | undefined;
  const { repository, service } = setup({
    runtimeFactory: () => ({
      ...state.runtime,
      async observe(selection, identities) {
        observedSelection = structuredClone(selection);
        return state.runtime.observe(selection, identities);
      },
    }),
  });
  await createProject(repository);
  const result = await service.preview({
    projectID: "project-sync-service",
    selection: {
      libraryID: 1,
      collectionKey: "  COLLECTION-A  ",
      tagNames: ["  reviewed  "],
    },
  });

  assert.deepEqual(observedSelection, {
    libraryID: 1,
    collectionKey: "COLLECTION-A",
    tagNames: ["reviewed"],
  });
  assert.deepEqual(result.selection, observedSelection);
});

test("service rejects project and Zotero drift before invoking apply", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => state.runtime,
  });
  const { members } = await createProject(repository);
  const approved = await preview(service);
  await repository.updateMembers(
    approved.projectID,
    members.revision,
    (current) => current.map((member) => ({ ...member, userNote: "changed" })),
  );
  await assert.rejects(
    service.apply({
      preview: approved,
      approvalToken: approved.approvalToken,
    }),
    /membership changed/,
  );
  assert.equal(state.applyCalls, 0);

  const second = await preview(service);
  const changed = structuredClone(
    await state.runtime.observe(second.selection, []),
  );
  changed.items[0].tagNames.push("changed-after-preview");
  state.setObserved(changed);
  await assert.rejects(
    service.apply({
      preview: second,
      approvalToken: second.approvalToken,
    }),
    /library changed after this sync preview/,
  );
  assert.equal(state.applyCalls, 0);
});

test("runtime failure leaves a failed receipt without fabricated ownership", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => ({
      ...state.runtime,
      async apply() {
        throw new Error("Zotero.DB.executeTransaction is unavailable.");
      },
    }),
  });
  await createProject(repository);
  const approved = await preview(service);
  await assert.rejects(
    service.apply({
      preview: approved,
      approvalToken: approved.approvalToken,
    }),
    /executeTransaction is unavailable/,
  );
  const receipts = await service.listReceipts(approved.projectID);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].receipt.status, "failed");
  assert.equal(receipts[0].receipt.applyResults, undefined);
  assert.match(receipts[0].receipt.error ?? "", /executeTransaction/);
});

test("partial undo remains retryable and becomes undone only after every owned addition clears", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => state.runtime,
  });
  await createProject(repository);
  const approved = await preview(service);
  const committed = await service.apply({
    preview: approved,
    approvalToken: approved.approvalToken,
  });

  state.setUndoMode("blocked");
  const partial = await service.undo({
    projectID: approved.projectID,
    receiptID: committed.receipt.receiptID,
    expectedRevision: committed.revision,
  });
  assert.equal(partial.receipt.status, "partially-undone");
  assert.equal(partial.receipt.undoResults?.[0].status, "blocked");

  state.setUndoMode("undone");
  const undone = await service.undo({
    projectID: approved.projectID,
    receiptID: committed.receipt.receiptID,
    expectedRevision: partial.revision,
  });
  assert.equal(undone.receipt.status, "undone");
  assert.equal(undone.receipt.undoResults?.[0].status, "undone");
  assert.equal(state.undoCalls, 2);
});

test("service rejects approval-token mismatch before creating a receipt", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => state.runtime,
  });
  await createProject(repository);
  const approved = await preview(service);
  await assert.rejects(
    service.apply({ preview: approved, approvalToken: "wrong-token" }),
    /not bound to this exact sync preview/,
  );
  assert.equal((await service.listReceipts(approved.projectID)).length, 0);
  assert.equal(state.applyCalls, 0);
});

test("an unresolved prepared receipt blocks blind reapplication of the exact preview", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => state.runtime,
  });
  await createProject(repository);
  const approved = await preview(service);
  const createdAt = "2026-08-30T05:30:00.000Z";
  const unresolved: ResearchWorkspaceZoteroSyncReceipt = {
    receiptID: "zotero-sync-receipt-unresolved",
    projectID: approved.projectID,
    status: "prepared",
    membersRevision: approved.membersRevision,
    selection: structuredClone(approved.selection),
    previewID: approved.previewID,
    previewFingerprint: fingerprintResearchWorkspaceZoteroSyncPreview(approved),
    approvalTokenFingerprint:
      fingerprintResearchWorkspaceZoteroSyncApprovalToken(
        approved.approvalToken,
      ),
    observedStateFingerprint: approved.observedStateFingerprint,
    plannedItems: structuredClone(approved.items),
    createdAt,
    updatedAt: createdAt,
  };
  await repository.createZoteroSyncReceipt(approved.projectID, unresolved);

  await assert.rejects(
    service.apply({
      preview: approved,
      approvalToken: approved.approvalToken,
    }),
    /already has write-ahead receipt/,
  );
  assert.equal(state.applyCalls, 0);
  assert.equal((await service.listReceipts(approved.projectID)).length, 1);
});

test("receipt finalization failure triggers compensating undo instead of leaving additions orphaned", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => state.runtime,
  });
  await createProject(repository, "project-finalization-compensation");
  const approved = await preview(service, "project-finalization-compensation");
  const originalUpdate = repository.updateZoteroSyncReceipt.bind(repository);
  let failedCommit = false;
  repository.updateZoteroSyncReceipt = (async (
    projectID,
    receiptID,
    expectedRevision,
    mutate,
  ) => {
    const current = await repository.getZoteroSyncReceipt(projectID, receiptID);
    assert(current);
    const candidate = mutate(structuredClone(current.receipt));
    if (candidate.status === "committed" && !failedCommit) {
      failedCommit = true;
      throw new Error("simulated receipt finalization failure");
    }
    return originalUpdate(projectID, receiptID, expectedRevision, mutate);
  }) as typeof repository.updateZoteroSyncReceipt;

  await assert.rejects(
    service.apply({
      preview: approved,
      approvalToken: approved.approvalToken,
    }),
    /rolled back the approved additions/,
  );
  assert.equal(state.applyCalls, 1);
  assert.equal(state.undoCalls, 1);
  const receipts = await service.listReceipts(approved.projectID);
  assert.equal(receipts[0].receipt.status, "undone");
  assert.equal(receipts[0].receipt.applyResults?.[0].status, "applied");
  assert.equal(receipts[0].receipt.undoResults?.[0].status, "undone");
  assert.equal(receipts[0].receipt.error, undefined);
});

test("incomplete compensation preserves per-item ownership in a partially-undone receipt", async () => {
  const state = runtimeState();
  state.setUndoMode("blocked");
  const { repository, service } = setup({
    runtimeFactory: () => state.runtime,
  });
  await createProject(repository, "project-partial-compensation");
  const approved = await preview(service, "project-partial-compensation");
  const originalUpdate = repository.updateZoteroSyncReceipt.bind(repository);
  let failedCommit = false;
  repository.updateZoteroSyncReceipt = (async (
    projectID,
    receiptID,
    expectedRevision,
    mutate,
  ) => {
    const current = await repository.getZoteroSyncReceipt(projectID, receiptID);
    assert(current);
    const candidate = mutate(structuredClone(current.receipt));
    if (candidate.status === "committed" && !failedCommit) {
      failedCommit = true;
      throw new Error("simulated receipt finalization failure");
    }
    return originalUpdate(projectID, receiptID, expectedRevision, mutate);
  }) as typeof repository.updateZoteroSyncReceipt;

  await assert.rejects(
    service.apply({
      preview: approved,
      approvalToken: approved.approvalToken,
    }),
    /recovered the receipt as partially-undone/,
  );
  const [partial] = await service.listReceipts(approved.projectID);
  assert.equal(partial.receipt.status, "partially-undone");
  assert.equal(partial.receipt.applyResults?.[0].status, "applied");
  assert.equal(partial.receipt.undoResults?.[0].status, "blocked");

  state.setUndoMode("undone");
  const undone = await service.undo({
    projectID: approved.projectID,
    receiptID: partial.receipt.receiptID,
    expectedRevision: partial.revision,
  });
  assert.equal(undone.receipt.status, "undone");
});

test("compensation failure recovers a committed ownership receipt", async () => {
  const state = runtimeState();
  const { repository, service } = setup({
    runtimeFactory: () => ({
      ...state.runtime,
      async undo() {
        throw new Error("simulated compensation failure");
      },
    }),
  });
  await createProject(repository, "project-compensation-failure");
  const approved = await preview(service, "project-compensation-failure");
  const originalUpdate = repository.updateZoteroSyncReceipt.bind(repository);
  let failedCommit = false;
  repository.updateZoteroSyncReceipt = (async (
    projectID,
    receiptID,
    expectedRevision,
    mutate,
  ) => {
    const current = await repository.getZoteroSyncReceipt(projectID, receiptID);
    assert(current);
    const candidate = mutate(structuredClone(current.receipt));
    if (candidate.status === "committed" && !failedCommit) {
      failedCommit = true;
      throw new Error("simulated receipt finalization failure");
    }
    return originalUpdate(projectID, receiptID, expectedRevision, mutate);
  }) as typeof repository.updateZoteroSyncReceipt;

  await assert.rejects(
    service.apply({
      preview: approved,
      approvalToken: approved.approvalToken,
    }),
    /recovered receipt .* committed ownership results/,
  );
  const [committed] = await service.listReceipts(approved.projectID);
  assert.equal(committed.receipt.status, "committed");
  assert.equal(committed.receipt.applyResults?.[0].status, "applied");
  assert.equal(committed.receipt.undoResults, undefined);
});
