import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  ResearchWorkspaceRevisionConflictError,
  type ResearchWorkspaceFileOps,
  type ResearchWorkspaceSourceRecord,
} from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import {
  buildResearchWorkspaceZoteroSyncPreview,
  fingerprintResearchWorkspaceZoteroSyncApprovalToken,
  fingerprintResearchWorkspaceZoteroSyncPreview,
  type ResearchWorkspaceZoteroSyncReceipt,
} from "../src/modules/researchWorkspace/zoteroSync";

class MemoryFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

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
    this.files.set(path, contents);
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const entry of [...this.files.keys()]) {
      if (entry === path || (options?.recursive && entry.startsWith(prefix))) {
        this.files.delete(entry);
      }
    }
    for (const entry of [...this.directories]) {
      if (entry === path || (options?.recursive && entry.startsWith(prefix))) {
        this.directories.delete(entry);
      }
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function source(): ResearchWorkspaceSourceRecord {
  return {
    sourceID: "zotero:1:ITEM-A:PDF-A",
    identity: {
      libraryID: 1,
      itemKey: "ITEM-A",
      attachmentKey: "PDF-A",
      standaloneAttachment: false,
    },
    title: "Paper A",
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: "2026-08-30T06:00:00.000Z",
  };
}

function setup() {
  const files = new MemoryFiles();
  let clock = Date.parse("2026-08-30T06:00:00.000Z");
  let id = 0;
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir: "/profile/paperpilot-research-workspace",
    fileOps: files,
    now: () => new Date(clock++),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  return { files, repository };
}

async function preparedReceipt(repository: ResearchWorkspaceProjectRepository) {
  const project = await repository.createProject({
    projectID: "project-sync-persistence",
    name: "Sync persistence",
  });
  const paper = source();
  await repository.putSource(paper);
  const members = await repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: paper.sourceID }],
  );
  const preview = buildResearchWorkspaceZoteroSyncPreview({
    projectID: project.project.projectID,
    membersRevision: members.revision,
    sources: [paper],
    selection: {
      libraryID: 1,
      collectionKey: "COLLECTION-A",
      tagNames: ["reviewed"],
    },
    observedState: {
      libraryID: 1,
      collection: {
        libraryID: 1,
        collectionKey: "COLLECTION-A",
        name: "Existing collection",
      },
      existingTagNames: ["reviewed"],
      items: [
        {
          libraryID: 1,
          itemKey: "ITEM-A",
          itemKind: "regular-item",
          eligibleForAdditiveSync: true,
          available: true,
          version: 3,
          collectionKeys: [],
          tagNames: [],
        },
      ],
    },
    previewID: "preview-sync-persistence",
    createdAt: "2026-08-30T06:01:00.000Z",
  });
  const receipt: ResearchWorkspaceZoteroSyncReceipt = {
    receiptID: "zotero-sync-receipt-persistence",
    projectID: preview.projectID,
    status: "prepared",
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
    createdAt: "2026-08-30T06:02:00.000Z",
    updatedAt: "2026-08-30T06:02:00.000Z",
  };
  return { project, preview, receipt };
}

test("sync receipts persist outside artifact history with their own revisions", async () => {
  const { files, repository } = setup();
  const { project, receipt } = await preparedReceipt(repository);
  const created = await repository.createZoteroSyncReceipt(
    project.project.projectID,
    receipt,
  );

  assert.equal(created.revision, 1);
  assert.equal(created.receipt.status, "prepared");
  const path = repository.getSyncReceiptPath(
    project.project.projectID,
    receipt.receiptID,
  );
  assert(path.includes("/sync-receipts/receipt-"));
  assert.equal(files.files.has(path), true);
  assert.deepEqual(
    (await repository.listZoteroSyncReceipts(project.project.projectID)).map(
      (file) => file.receipt.receiptID,
    ),
    [receipt.receiptID],
  );
  assert.deepEqual(
    (await repository.getProject(project.project.projectID)).project
      .artifactIDs,
    [],
  );
  assert.equal(
    (await repository.listArtifacts(project.project.projectID)).artifacts
      .length,
    0,
  );
});

test("sync receipt updates are revision guarded and parser validated", async () => {
  const { repository } = setup();
  const { project, receipt } = await preparedReceipt(repository);
  const created = await repository.createZoteroSyncReceipt(
    project.project.projectID,
    receipt,
  );
  const updated = await repository.updateZoteroSyncReceipt(
    project.project.projectID,
    receipt.receiptID,
    created.revision,
    (current) => ({
      ...current,
      status: "failed",
      error: "Transaction unavailable",
      updatedAt: "2026-08-30T06:03:00.000Z",
    }),
  );
  assert.equal(updated.revision, 2);
  assert.equal(updated.receipt.status, "failed");

  await assert.rejects(
    repository.updateZoteroSyncReceipt(
      project.project.projectID,
      receipt.receiptID,
      created.revision,
      (current) => current,
    ),
    ResearchWorkspaceRevisionConflictError,
  );
  await assert.rejects(
    repository.updateZoteroSyncReceipt(
      project.project.projectID,
      receipt.receiptID,
      updated.revision,
      (current) => ({ ...current, receiptID: "changed-identity" }),
    ),
    /cannot change identity/,
  );
});

test("deleting a project removes its receipt directory without touching shared sources", async () => {
  const { files, repository } = setup();
  const { project, receipt } = await preparedReceipt(repository);
  await repository.createZoteroSyncReceipt(project.project.projectID, receipt);
  const receiptPath = repository.getSyncReceiptPath(
    project.project.projectID,
    receipt.receiptID,
  );
  const sourcePath = repository.getSourcePath(source().sourceID);
  assert.equal(files.files.has(receiptPath), true);
  assert.equal(files.files.has(sourcePath), true);

  await repository.deleteProject(project.project.projectID);
  assert.equal(files.files.has(receiptPath), false);
  assert.equal(files.files.has(sourcePath), true);
});
