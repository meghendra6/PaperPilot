import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("safe Zotero sync UI exposes full preview, exact approval, receipts, and owned undo", () => {
  const view = source("src/modules/researchWorkspace/projectWindowView.ts");
  for (const expected of [
    "Safe Zotero collection and tag sync",
    "One-way additive sync only",
    "Load existing Zotero targets",
    "Existing collection (optional)",
    "Existing tags (optional)",
    "Build full sync preview",
    "Full additive sync preview",
    "Safety boundaries",
    "Preview-bound approval token",
    "Enter the preview-bound approval token",
    "Apply approved additive sync",
    "Write-ahead receipts",
    "Undo receipt-owned additions",
    "Sync receipt history could not be read",
  ]) {
    assert.match(
      view,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(view, /tokenInput\.value\.trim\(\) !== preview\.approvalToken/);
  assert.match(view, /expectedRevision: file\.revision/);
  assert.match(view, /never creates or deletes items, collections, or tags/i);
  assert.match(view, /never writes bibliographic metadata, PDFs, annotations/i);
});

test("safe Zotero sync uses a transaction and stable identities without creation APIs", () => {
  const runtime = source("src/modules/researchWorkspace/zoteroSyncRuntime.ts");
  const core = source("src/modules/researchWorkspace/zoteroSync.ts");
  const service = source("src/modules/researchWorkspace/zoteroSyncService.ts");
  const repository = source(
    "src/modules/researchWorkspace/persistence/projectRepository.ts",
  );

  assert.match(runtime, /Zotero\.DB\.executeTransaction is missing/);
  assert.match(runtime, /paperPilotSyncReceiptID/);
  assert.match(runtime, /paperPilotSyncAction/);
  assert.match(runtime, /getByLibraryAndKey/);
  assert.match(runtime, /addItems/);
  assert.match(runtime, /addTag/);
  assert.match(runtime, /removeItems/);
  assert.match(runtime, /removeTag/);
  assert.match(core, /libraryID[\s\S]*itemKey/);
  assert.match(core, /collectionKey/);
  assert.match(service, /createZoteroSyncReceipt/);
  assert.match(service, /status: "prepared"/);
  assert.match(service, /observedStateFingerprint/);
  assert.match(repository, /sync-receipts/);

  for (const forbidden of [
    /new\s+Zotero\.Item/,
    /Items\.create/,
    /Collections\.create/,
    /Tags\.create/,
    /eraseTx/,
    /setField\(/,
    /setNote\(/,
  ]) {
    assert.doesNotMatch(runtime, forbidden);
    assert.doesNotMatch(service, forbidden);
  }
});

test("safe Zotero sync facade and storage expose only project-scoped operations", () => {
  const facade = source("src/modules/researchWorkspace/facade.ts");
  const storage = source("src/modules/researchWorkspace/storage.ts");
  for (const name of [
    "listResearchWorkspaceZoteroSyncTargets",
    "previewResearchWorkspaceZoteroSync",
    "applyResearchWorkspaceZoteroSync",
    "listResearchWorkspaceZoteroSyncReceipts",
    "undoResearchWorkspaceZoteroSync",
  ]) {
    assert.match(facade, new RegExp(`export function ${name}`));
  }
  assert.match(storage, /ResearchWorkspaceZoteroSyncService/);
  assert.match(storage, /getResearchWorkspaceProjectRepository\(\)/);
});

test("safe Zotero sync documentation covers architecture, QA, spec, and every README locale", () => {
  const expectations: Array<[string, RegExp]> = [
    ["docs/architecture.md", /Safe Zotero collection and tag sync/],
    ["docs/manual-qa.md", /Safe Zotero collection and tag sync/],
    ["docs/research-workspace-redesign-spec.md", /write-ahead receipt/],
    ["README.md", /safe Zotero collection\/tag sync/i],
    ["README.ko.md", /안전한 Zotero collection\/tag 동기화/],
    ["README.zh-CN.md", /安全的 Zotero collection\/tag 同步/],
    ["README.zh-TW.md", /安全的 Zotero collection\/tag 同步/],
  ];
  for (const [path, pattern] of expectations) {
    assert.match(
      source(path),
      pattern,
      `${path} must document safe Zotero sync`,
    );
  }
});
