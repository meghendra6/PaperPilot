export const RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS = 10_000;
export const RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_TAGS = 100;

export type ResearchWorkspaceZoteroItemKind =
  | "regular-item"
  | "attachment"
  | "annotation"
  | "note"
  | "unknown";

export interface ResearchWorkspaceZoteroItemIdentity {
  libraryID: number;
  itemKey: string;
}

export interface ResearchWorkspaceZoteroCollectionIdentity {
  libraryID: number;
  collectionKey: string;
}

export interface ResearchWorkspaceZoteroSyncSelection {
  libraryID: number;
  collectionKey?: string;
  tagNames: string[];
}

export interface ResearchWorkspaceZoteroSyncCollectionSnapshot
  extends ResearchWorkspaceZoteroCollectionIdentity {
  name: string;
  version?: number;
}

export interface ResearchWorkspaceZoteroSyncItemSnapshot
  extends ResearchWorkspaceZoteroItemIdentity {
  title?: string;
  version?: number;
  itemKind: ResearchWorkspaceZoteroItemKind;
  eligibleForAdditiveSync: boolean;
  collectionKeys: string[];
  tagNames: string[];
  available: boolean;
}

export interface ResearchWorkspaceZoteroSyncObservedState {
  libraryID: number;
  collection?: ResearchWorkspaceZoteroSyncCollectionSnapshot;
  existingTagNames: string[];
  items: ResearchWorkspaceZoteroSyncItemSnapshot[];
}

export interface ResearchWorkspaceZoteroSyncPreviewItem
  extends ResearchWorkspaceZoteroItemIdentity {
  sourceIDs: string[];
  title?: string;
  observedVersion?: number;
  itemKind: ResearchWorkspaceZoteroItemKind;
  beforeCollectionKeys: string[];
  beforeTagNames: string[];
  addCollection: boolean;
  addTagNames: string[];
  status: "additive" | "no-op" | "blocked";
  blockedReason?: string;
}

export interface ResearchWorkspaceZoteroSyncPreview {
  schemaVersion: typeof RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION;
  previewID: string;
  projectID: string;
  membersRevision: number;
  createdAt: string;
  selection: ResearchWorkspaceZoteroSyncSelection;
  collection?: ResearchWorkspaceZoteroSyncCollectionSnapshot;
  observedStateFingerprint: string;
  items: ResearchWorkspaceZoteroSyncPreviewItem[];
  summary: {
    totalItems: number;
    additiveItems: number;
    noOpItems: number;
    blockedItems: number;
    collectionAdditions: number;
    tagAdditions: number;
  };
  approvalToken: string;
}

export interface ResearchWorkspaceZoteroSyncApplyItemResult
  extends ResearchWorkspaceZoteroItemIdentity {
  status: "applied" | "no-op" | "blocked";
  collectionAdded: boolean;
  tagNamesAdded: string[];
  afterCollectionKeys: string[];
  afterTagNames: string[];
  versionAfter?: number;
  notifierDataIncluded: boolean;
  message?: string;
}

export interface ResearchWorkspaceZoteroSyncUndoItemResult
  extends ResearchWorkspaceZoteroItemIdentity {
  status: "undone" | "partially-undone" | "no-op" | "blocked" | "failed";
  collectionRemoved: boolean;
  tagNamesRemoved: string[];
  notifierDataIncluded: boolean;
  message?: string;
}

export type ResearchWorkspaceZoteroSyncReceiptStatus =
  | "prepared"
  | "committed"
  | "failed"
  | "partially-undone"
  | "undone";

export interface ResearchWorkspaceZoteroSyncReceipt {
  receiptID: string;
  projectID: string;
  status: ResearchWorkspaceZoteroSyncReceiptStatus;
  membersRevision: number;
  selection: ResearchWorkspaceZoteroSyncSelection;
  previewID: string;
  previewFingerprint: string;
  approvalTokenFingerprint: string;
  observedStateFingerprint: string;
  plannedItems: ResearchWorkspaceZoteroSyncPreviewItem[];
  applyResults?: ResearchWorkspaceZoteroSyncApplyItemResult[];
  undoResults?: ResearchWorkspaceZoteroSyncUndoItemResult[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  undoneAt?: string;
}

export interface ResearchWorkspaceZoteroSyncReceiptFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION;
  revision: number;
  receipt: ResearchWorkspaceZoteroSyncReceipt;
}

export interface ResearchWorkspaceZoteroSyncTargets {
  libraries: Array<{
    libraryID: number;
    collections: ResearchWorkspaceZoteroSyncCollectionSnapshot[];
    tagNames: string[];
  }>;
  limitations: string[];
}
