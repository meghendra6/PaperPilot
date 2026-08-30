import type { ResearchWorkspaceSourceRecord } from "./persistence/contracts";

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

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedArray(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array of at most ${maximum}.`);
  }
  return value;
}

function requiredText(value: unknown, label: string, maximum = 1_000) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} is too long.`);
  return normalized;
}

function optionalText(value: unknown, label: string, maximum = 1_000) {
  if (value === undefined) return undefined;
  return requiredText(value, label, maximum);
}

function positiveInteger(value: unknown, label: string) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return normalized;
}

function nonNegativeInteger(value: unknown, label: string) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return normalized;
}

function optionalNonNegativeInteger(value: unknown, label: string) {
  return value === undefined ? undefined : nonNegativeInteger(value, label);
}

function isoDate(value: unknown, label: string) {
  const normalized = requiredText(value, label, 100);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO date.`);
  }
  return normalized;
}

function uniqueTexts(value: unknown, label: string, maximum: number) {
  const result = boundedArray(value, label, maximum).map((entry, index) =>
    requiredText(entry, `${label} ${index + 1}`, 500),
  );
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function itemKind(
  value: unknown,
  label: string,
): ResearchWorkspaceZoteroItemKind {
  if (
    value !== "regular-item" &&
    value !== "attachment" &&
    value !== "annotation" &&
    value !== "note" &&
    value !== "unknown"
  ) {
    throw new Error(`${label} is unsupported.`);
  }
  return value;
}

function identity(value: Record<string, unknown>, label: string) {
  return {
    libraryID: positiveInteger(value.libraryID, `${label} libraryID`),
    itemKey: requiredText(value.itemKey, `${label} itemKey`, 100),
  };
}

export function researchWorkspaceZoteroItemIdentityKey(
  value: ResearchWorkspaceZoteroItemIdentity,
) {
  return `${value.libraryID}:${value.itemKey}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonical(object[key])]),
  );
}

function stableHash(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function fingerprint(prefix: string, value: unknown) {
  const serialized = JSON.stringify(canonical(value));
  return `${prefix}:${stableHash(serialized, 2166136261)}${stableHash(
    serialized,
    2246822519,
  )}:${serialized.length}`;
}

export function normalizeResearchWorkspaceZoteroSyncSelection(
  value: ResearchWorkspaceZoteroSyncSelection,
) {
  const selection = record(value, "Zotero sync selection");
  const collectionKey = optionalText(
    selection.collectionKey,
    "Zotero sync collectionKey",
    100,
  );
  const tagNames = uniqueTexts(
    selection.tagNames,
    "Zotero sync tag names",
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_TAGS,
  );
  if (!collectionKey && !tagNames.length) {
    throw new Error(
      "Select an existing collection, at least one existing tag, or both.",
    );
  }
  return {
    libraryID: positiveInteger(selection.libraryID, "Zotero sync libraryID"),
    ...(collectionKey ? { collectionKey } : {}),
    tagNames,
  } satisfies ResearchWorkspaceZoteroSyncSelection;
}

function normalizeCollection(value: unknown, label: string) {
  const collection = record(value, label);
  const version = optionalNonNegativeInteger(
    collection.version,
    `${label} version`,
  );
  return {
    libraryID: positiveInteger(collection.libraryID, `${label} libraryID`),
    collectionKey: requiredText(
      collection.collectionKey,
      `${label} collectionKey`,
      100,
    ),
    name: requiredText(collection.name, `${label} name`, 500),
    ...(version !== undefined ? { version } : {}),
  } satisfies ResearchWorkspaceZoteroSyncCollectionSnapshot;
}

function normalizeObservedState(
  value: ResearchWorkspaceZoteroSyncObservedState,
) {
  const observed = record(value, "Zotero sync observed state");
  const items = boundedArray(
    observed.items,
    "Zotero sync observed items",
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS,
  ).map((entry, index) => {
    const item = record(entry, `Zotero sync observed item ${index + 1}`);
    const version = optionalNonNegativeInteger(
      item.version,
      `Zotero sync observed item ${index + 1} version`,
    );
    if (typeof item.available !== "boolean") {
      throw new Error("Zotero sync observed item available must be boolean.");
    }
    if (typeof item.eligibleForAdditiveSync !== "boolean") {
      throw new Error("Zotero sync observed item eligibility must be boolean.");
    }
    const kind = itemKind(
      item.itemKind,
      `Zotero sync observed item ${index + 1} kind`,
    );
    if (item.eligibleForAdditiveSync !== (kind === "regular-item")) {
      throw new Error("Zotero sync item eligibility does not match its kind.");
    }
    return {
      ...identity(item, `Zotero sync observed item ${index + 1}`),
      ...(optionalText(
        item.title,
        `Zotero sync observed item ${index + 1} title`,
        500,
      )
        ? {
            title: optionalText(
              item.title,
              `Zotero sync observed item ${index + 1} title`,
              500,
            ),
          }
        : {}),
      ...(version !== undefined ? { version } : {}),
      itemKind: kind,
      eligibleForAdditiveSync: item.eligibleForAdditiveSync,
      collectionKeys: uniqueTexts(
        item.collectionKeys,
        `Zotero sync observed item ${index + 1} collection keys`,
        10_000,
      ),
      tagNames: uniqueTexts(
        item.tagNames,
        `Zotero sync observed item ${index + 1} tag names`,
        10_000,
      ),
      available: item.available,
    } satisfies ResearchWorkspaceZoteroSyncItemSnapshot;
  });
  items.sort((left, right) =>
    researchWorkspaceZoteroItemIdentityKey(left).localeCompare(
      researchWorkspaceZoteroItemIdentityKey(right),
    ),
  );
  const identities = new Set<string>();
  for (const item of items) {
    const key = researchWorkspaceZoteroItemIdentityKey(item);
    if (identities.has(key)) throw new Error(`Duplicate observed item ${key}.`);
    identities.add(key);
  }
  return {
    libraryID: positiveInteger(
      observed.libraryID,
      "Zotero sync observed libraryID",
    ),
    ...(observed.collection
      ? {
          collection: normalizeCollection(
            observed.collection,
            "Zotero sync observed collection",
          ),
        }
      : {}),
    existingTagNames: uniqueTexts(
      observed.existingTagNames,
      "Zotero sync existing tag names",
      100_000,
    ),
    items,
  } satisfies ResearchWorkspaceZoteroSyncObservedState;
}

export function fingerprintResearchWorkspaceZoteroSyncObservedState(
  value: ResearchWorkspaceZoteroSyncObservedState,
) {
  return fingerprint(
    "paperpilot-zotero-sync-state-v1",
    normalizeObservedState(value),
  );
}

function previewWithoutApproval(preview: ResearchWorkspaceZoteroSyncPreview) {
  const { approvalToken: _approvalToken, ...body } = preview;
  return body;
}

export function fingerprintResearchWorkspaceZoteroSyncPreview(
  preview: ResearchWorkspaceZoteroSyncPreview,
) {
  return fingerprint(
    "paperpilot-zotero-sync-preview-v1",
    previewWithoutApproval(preview),
  );
}

export function createResearchWorkspaceZoteroSyncApprovalToken(
  preview: ResearchWorkspaceZoteroSyncPreview,
) {
  return fingerprint(
    "paperpilot-zotero-sync-approval-v1",
    previewWithoutApproval(preview),
  );
}

export function verifyResearchWorkspaceZoteroSyncApproval(
  preview: ResearchWorkspaceZoteroSyncPreview,
  approvalToken: string,
) {
  const supplied = requiredText(
    approvalToken,
    "Zotero sync approval token",
    500,
  );
  const expected = createResearchWorkspaceZoteroSyncApprovalToken(preview);
  if (preview.approvalToken !== expected || supplied !== expected) {
    throw new Error(
      "The approval token is not bound to this exact sync preview. Generate and review a new preview.",
    );
  }
  return expected;
}

function previewSummary(
  items: readonly ResearchWorkspaceZoteroSyncPreviewItem[],
) {
  return {
    totalItems: items.length,
    additiveItems: items.filter((item) => item.status === "additive").length,
    noOpItems: items.filter((item) => item.status === "no-op").length,
    blockedItems: items.filter((item) => item.status === "blocked").length,
    collectionAdditions: items.filter((item) => item.addCollection).length,
    tagAdditions: items.reduce(
      (total, item) => total + item.addTagNames.length,
      0,
    ),
  };
}

export function buildResearchWorkspaceZoteroSyncPreview(params: {
  projectID: string;
  membersRevision: number;
  sources: readonly ResearchWorkspaceSourceRecord[];
  selection: ResearchWorkspaceZoteroSyncSelection;
  observedState: ResearchWorkspaceZoteroSyncObservedState;
  previewID: string;
  createdAt: string;
}): ResearchWorkspaceZoteroSyncPreview {
  const selection = normalizeResearchWorkspaceZoteroSyncSelection(
    params.selection,
  );
  const observedState = normalizeObservedState(params.observedState);
  if (selection.libraryID !== observedState.libraryID) {
    throw new Error(
      "The observed Zotero library does not match the sync selection.",
    );
  }
  if (selection.collectionKey) {
    if (
      observedState.collection?.libraryID !== selection.libraryID ||
      observedState.collection.collectionKey !== selection.collectionKey
    ) {
      throw new Error(
        "The selected existing Zotero collection is unavailable.",
      );
    }
  }
  const existingTags = new Set(observedState.existingTagNames);
  const missingTags = selection.tagNames.filter(
    (tagName) => !existingTags.has(tagName),
  );
  if (missingTags.length) {
    throw new Error(
      `The selected Zotero tags no longer exist: ${missingTags.join(", ")}.`,
    );
  }

  const sourcesByIdentity = new Map<
    string,
    ResearchWorkspaceZoteroItemIdentity & {
      sourceIDs: string[];
      title?: string;
    }
  >();
  for (const source of params.sources) {
    const identity = {
      libraryID: source.identity.libraryID,
      itemKey: source.identity.itemKey,
    };
    const key = researchWorkspaceZoteroItemIdentityKey(identity);
    const current = sourcesByIdentity.get(key);
    if (current) {
      current.sourceIDs.push(source.sourceID);
      current.sourceIDs.sort();
      continue;
    }
    sourcesByIdentity.set(key, {
      ...identity,
      sourceIDs: [source.sourceID],
      ...(source.title ? { title: source.title } : {}),
    });
  }
  if (!sourcesByIdentity.size) {
    throw new Error("Safe Zotero sync requires at least one project source.");
  }
  if (sourcesByIdentity.size > RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS) {
    throw new Error(
      `A sync preview supports at most ${RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS} stable items.`,
    );
  }
  const observedByIdentity = new Map(
    observedState.items.map((item) => [
      researchWorkspaceZoteroItemIdentityKey(item),
      item,
    ]),
  );
  const items: ResearchWorkspaceZoteroSyncPreviewItem[] = [];
  for (const source of [...sourcesByIdentity.values()].sort((left, right) =>
    researchWorkspaceZoteroItemIdentityKey(left).localeCompare(
      researchWorkspaceZoteroItemIdentityKey(right),
    ),
  )) {
    const observed = observedByIdentity.get(
      researchWorkspaceZoteroItemIdentityKey(source),
    );
    const base = {
      libraryID: source.libraryID,
      itemKey: source.itemKey,
      sourceIDs: [...source.sourceIDs],
      title: observed?.title ?? source.title,
      ...(observed?.version !== undefined
        ? { observedVersion: observed.version }
        : {}),
      itemKind: observed?.itemKind ?? ("unknown" as const),
      beforeCollectionKeys: [...(observed?.collectionKeys ?? [])],
      beforeTagNames: [...(observed?.tagNames ?? [])],
    };
    if (source.libraryID !== selection.libraryID) {
      items.push({
        ...base,
        addCollection: false,
        addTagNames: [],
        status: "blocked",
        blockedReason: "The item belongs to a different Zotero library.",
      });
      continue;
    }
    if (!observed?.available) {
      items.push({
        ...base,
        addCollection: false,
        addTagNames: [],
        status: "blocked",
        blockedReason: "The stable Zotero item identity no longer resolves.",
      });
      continue;
    }
    if (!observed.eligibleForAdditiveSync) {
      items.push({
        ...base,
        addCollection: false,
        addTagNames: [],
        status: "blocked",
        blockedReason: `Writing ${observed.itemKind} items is prohibited; only regular bibliographic items are eligible.`,
      });
      continue;
    }
    const addCollection = Boolean(
      selection.collectionKey &&
        !observed.collectionKeys.includes(selection.collectionKey),
    );
    const addTagNames = selection.tagNames.filter(
      (tagName) => !observed.tagNames.includes(tagName),
    );
    items.push({
      ...base,
      addCollection,
      addTagNames,
      status: addCollection || addTagNames.length ? "additive" : "no-op",
    });
  }

  const preview: ResearchWorkspaceZoteroSyncPreview = {
    schemaVersion: RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION,
    previewID: requiredText(params.previewID, "Zotero sync previewID", 200),
    projectID: requiredText(params.projectID, "Zotero sync projectID", 200),
    membersRevision: nonNegativeInteger(
      params.membersRevision,
      "Zotero sync members revision",
    ),
    createdAt: isoDate(params.createdAt, "Zotero sync preview createdAt"),
    selection,
    ...(observedState.collection
      ? { collection: clone(observedState.collection) }
      : {}),
    observedStateFingerprint:
      fingerprintResearchWorkspaceZoteroSyncObservedState(observedState),
    items,
    summary: previewSummary(items),
    approvalToken: "pending",
  };
  preview.approvalToken =
    createResearchWorkspaceZoteroSyncApprovalToken(preview);
  return parseResearchWorkspaceZoteroSyncPreview(preview);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function parsePreviewItem(
  value: unknown,
  selection: ResearchWorkspaceZoteroSyncSelection,
  label: string,
) {
  const item = record(value, label);
  const sourceIDs = uniqueTexts(
    item.sourceIDs,
    `${label} sourceIDs`,
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS,
  );
  if (!sourceIDs.length) throw new Error(`${label} requires a sourceID.`);
  const beforeCollectionKeys = uniqueTexts(
    item.beforeCollectionKeys,
    `${label} before collection keys`,
    10_000,
  );
  const beforeTagNames = uniqueTexts(
    item.beforeTagNames,
    `${label} before tag names`,
    10_000,
  );
  const addTagNames = uniqueTexts(
    item.addTagNames,
    `${label} added tag names`,
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_TAGS,
  );
  if (typeof item.addCollection !== "boolean") {
    throw new Error(`${label} addCollection must be boolean.`);
  }
  if (
    item.status !== "additive" &&
    item.status !== "no-op" &&
    item.status !== "blocked"
  ) {
    throw new Error(`${label} status is unsupported.`);
  }
  const kind = itemKind(item.itemKind, `${label} itemKind`);
  const itemIdentity = identity(item, label);
  const observedVersion = optionalNonNegativeInteger(
    item.observedVersion,
    `${label} observedVersion`,
  );
  const title = optionalText(item.title, `${label} title`, 500);
  if (
    item.addCollection &&
    (!selection.collectionKey ||
      itemIdentity.libraryID !== selection.libraryID ||
      beforeCollectionKeys.includes(selection.collectionKey))
  ) {
    throw new Error(`${label} has an invalid collection addition.`);
  }
  if (
    addTagNames.some(
      (tagName) =>
        !selection.tagNames.includes(tagName) ||
        beforeTagNames.includes(tagName),
    )
  ) {
    throw new Error(`${label} has an invalid tag addition.`);
  }
  const hasAddition = item.addCollection || addTagNames.length > 0;
  if (
    (item.status === "additive" && !hasAddition) ||
    (item.status !== "additive" && hasAddition)
  ) {
    throw new Error(`${label} status does not match its additions.`);
  }
  if (
    item.status === "additive" &&
    (kind !== "regular-item" || itemIdentity.libraryID !== selection.libraryID)
  ) {
    throw new Error(`${label} cannot add to an ineligible Zotero item.`);
  }
  const blockedReason = optionalText(
    item.blockedReason,
    `${label} blockedReason`,
    1_000,
  );
  if (item.status === "blocked" && !blockedReason) {
    throw new Error(`${label} requires a blocked reason.`);
  }
  if (item.status !== "blocked" && blockedReason) {
    throw new Error(`${label} cannot contain a blocked reason.`);
  }
  return {
    ...itemIdentity,
    sourceIDs,
    ...(title ? { title } : {}),
    ...(observedVersion !== undefined ? { observedVersion } : {}),
    itemKind: kind,
    beforeCollectionKeys,
    beforeTagNames,
    addCollection: item.addCollection,
    addTagNames,
    status: item.status,
    ...(blockedReason ? { blockedReason } : {}),
  } satisfies ResearchWorkspaceZoteroSyncPreviewItem;
}

export function parseResearchWorkspaceZoteroSyncPreview(
  value: unknown,
): ResearchWorkspaceZoteroSyncPreview {
  const preview = record(value, "Zotero sync preview");
  if (preview.schemaVersion !== RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION) {
    throw new Error("Zotero sync preview schema version is unsupported.");
  }
  requiredText(preview.previewID, "Zotero sync previewID", 200);
  requiredText(preview.projectID, "Zotero sync projectID", 200);
  nonNegativeInteger(preview.membersRevision, "Zotero sync members revision");
  isoDate(preview.createdAt, "Zotero sync preview createdAt");
  const selection = normalizeResearchWorkspaceZoteroSyncSelection(
    preview.selection as ResearchWorkspaceZoteroSyncSelection,
  );
  if (preview.collection) {
    const collection = normalizeCollection(
      preview.collection,
      "Zotero sync preview collection",
    );
    if (
      collection.libraryID !== selection.libraryID ||
      collection.collectionKey !== selection.collectionKey
    ) {
      throw new Error(
        "Zotero sync preview collection does not match selection.",
      );
    }
  } else if (selection.collectionKey) {
    throw new Error("Zotero sync preview is missing its selected collection.");
  }
  requiredText(
    preview.observedStateFingerprint,
    "Zotero sync observed-state fingerprint",
    500,
  );
  const items = boundedArray(
    preview.items,
    "Zotero sync preview items",
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS,
  ).map((entry, index) =>
    parsePreviewItem(entry, selection, `Zotero sync preview item ${index + 1}`),
  );
  const identities = items.map(researchWorkspaceZoteroItemIdentityKey);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Zotero sync preview contains duplicate item identities.");
  }
  const sortedIdentities = [...identities].sort();
  if (!sameStrings(identities, sortedIdentities)) {
    throw new Error(
      "Zotero sync preview items must use stable identity order.",
    );
  }
  const summary = record(preview.summary, "Zotero sync preview summary");
  const expectedSummary = previewSummary(items);
  for (const [key, expected] of Object.entries(expectedSummary)) {
    if (
      nonNegativeInteger(summary[key], `Zotero sync summary ${key}`) !==
      expected
    ) {
      throw new Error(`Zotero sync preview summary ${key} is inconsistent.`);
    }
  }
  const approvalToken = requiredText(
    preview.approvalToken,
    "Zotero sync approval token",
    500,
  );
  verifyResearchWorkspaceZoteroSyncApproval(
    value as ResearchWorkspaceZoteroSyncPreview,
    approvalToken,
  );
  return clone(value) as ResearchWorkspaceZoteroSyncPreview;
}

function parseApplyResult(value: unknown, label: string) {
  const result = record(value, label);
  const resultIdentity = identity(result, label);
  if (
    result.status !== "applied" &&
    result.status !== "no-op" &&
    result.status !== "blocked"
  ) {
    throw new Error(`${label} status is unsupported.`);
  }
  if (typeof result.collectionAdded !== "boolean") {
    throw new Error(`${label} collectionAdded must be boolean.`);
  }
  if (typeof result.notifierDataIncluded !== "boolean") {
    throw new Error(`${label} notifierDataIncluded must be boolean.`);
  }
  const tagNamesAdded = uniqueTexts(
    result.tagNamesAdded,
    `${label} added tags`,
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_TAGS,
  );
  const afterCollectionKeys = uniqueTexts(
    result.afterCollectionKeys,
    `${label} after collection keys`,
    10_000,
  );
  const afterTagNames = uniqueTexts(
    result.afterTagNames,
    `${label} after tag names`,
    10_000,
  );
  const versionAfter = optionalNonNegativeInteger(
    result.versionAfter,
    `${label} versionAfter`,
  );
  const message = optionalText(result.message, `${label} message`, 1_000);
  const changed = result.collectionAdded || tagNamesAdded.length > 0;
  if ((result.status === "applied") !== changed) {
    throw new Error(`${label} status does not match its additions.`);
  }
  if (result.notifierDataIncluded !== changed) {
    throw new Error(`${label} notifier flag does not match its additions.`);
  }
  return {
    ...resultIdentity,
    status: result.status,
    collectionAdded: result.collectionAdded,
    tagNamesAdded,
    afterCollectionKeys,
    afterTagNames,
    ...(versionAfter !== undefined ? { versionAfter } : {}),
    notifierDataIncluded: result.notifierDataIncluded,
    ...(message ? { message } : {}),
  } satisfies ResearchWorkspaceZoteroSyncApplyItemResult;
}

function parseUndoResult(value: unknown, label: string) {
  const result = record(value, label);
  const resultIdentity = identity(result, label);
  if (
    result.status !== "undone" &&
    result.status !== "partially-undone" &&
    result.status !== "no-op" &&
    result.status !== "blocked" &&
    result.status !== "failed"
  ) {
    throw new Error(`${label} status is unsupported.`);
  }
  if (typeof result.collectionRemoved !== "boolean") {
    throw new Error(`${label} collectionRemoved must be boolean.`);
  }
  if (typeof result.notifierDataIncluded !== "boolean") {
    throw new Error(`${label} notifierDataIncluded must be boolean.`);
  }
  const tagNamesRemoved = uniqueTexts(
    result.tagNamesRemoved,
    `${label} removed tags`,
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_TAGS,
  );
  const message = optionalText(result.message, `${label} message`, 1_000);
  const changed = result.collectionRemoved || tagNamesRemoved.length > 0;
  if (result.status === "undone" && !changed) {
    throw new Error(`${label} undone status requires a removal.`);
  }
  if (
    (result.status === "no-op" ||
      result.status === "blocked" ||
      result.status === "failed") &&
    changed
  ) {
    throw new Error(`${label} cannot remove data for its status.`);
  }
  if (result.notifierDataIncluded !== changed) {
    throw new Error(`${label} notifier flag does not match its removals.`);
  }
  return {
    ...resultIdentity,
    status: result.status,
    collectionRemoved: result.collectionRemoved,
    tagNamesRemoved,
    notifierDataIncluded: result.notifierDataIncluded,
    ...(message ? { message } : {}),
  } satisfies ResearchWorkspaceZoteroSyncUndoItemResult;
}

function validateApplyResultAgainstPlan(
  plan: ResearchWorkspaceZoteroSyncPreviewItem,
  result: ResearchWorkspaceZoteroSyncApplyItemResult,
  selection: ResearchWorkspaceZoteroSyncSelection,
) {
  if (
    researchWorkspaceZoteroItemIdentityKey(plan) !==
    researchWorkspaceZoteroItemIdentityKey(result)
  ) {
    throw new Error("Zotero sync result identity does not match its plan.");
  }
  if (plan.status === "additive") {
    if (
      result.status !== "applied" ||
      result.collectionAdded !== plan.addCollection ||
      !sameStrings(result.tagNamesAdded, plan.addTagNames)
    ) {
      throw new Error(
        "Zotero sync result does not match its approved additions.",
      );
    }
  } else if (
    result.status !== plan.status ||
    result.collectionAdded ||
    result.tagNamesAdded.length
  ) {
    throw new Error("Zotero sync result changed a blocked or no-op item.");
  }
  const expectedCollections = [
    ...new Set([
      ...plan.beforeCollectionKeys,
      ...(result.collectionAdded && selection.collectionKey
        ? [selection.collectionKey]
        : []),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const expectedTags = [
    ...new Set([...plan.beforeTagNames, ...result.tagNamesAdded]),
  ].sort((left, right) => left.localeCompare(right));
  if (
    !sameStrings(result.afterCollectionKeys, expectedCollections) ||
    !sameStrings(result.afterTagNames, expectedTags)
  ) {
    throw new Error(
      "Zotero sync result does not preserve the exact additive after-state.",
    );
  }
}

export function parseResearchWorkspaceZoteroSyncReceiptFile(
  value: unknown,
): ResearchWorkspaceZoteroSyncReceiptFile {
  const file = record(value, "Zotero sync receipt file");
  if (file.schemaVersion !== RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION) {
    throw new Error("Zotero sync receipt schema version is unsupported.");
  }
  nonNegativeInteger(file.revision, "Zotero sync receipt revision");
  const receipt = record(file.receipt, "Zotero sync receipt");
  requiredText(receipt.receiptID, "Zotero sync receiptID", 200);
  requiredText(receipt.projectID, "Zotero sync receipt projectID", 200);
  if (
    receipt.status !== "prepared" &&
    receipt.status !== "committed" &&
    receipt.status !== "failed" &&
    receipt.status !== "partially-undone" &&
    receipt.status !== "undone"
  ) {
    throw new Error("Zotero sync receipt status is unsupported.");
  }
  nonNegativeInteger(
    receipt.membersRevision,
    "Zotero sync receipt members revision",
  );
  const selection = normalizeResearchWorkspaceZoteroSyncSelection(
    receipt.selection as ResearchWorkspaceZoteroSyncSelection,
  );
  requiredText(receipt.previewID, "Zotero sync receipt previewID", 200);
  requiredText(
    receipt.previewFingerprint,
    "Zotero sync receipt preview fingerprint",
    500,
  );
  requiredText(
    receipt.approvalTokenFingerprint,
    "Zotero sync receipt approval fingerprint",
    500,
  );
  requiredText(
    receipt.observedStateFingerprint,
    "Zotero sync receipt observed fingerprint",
    500,
  );
  const plannedItems = boundedArray(
    receipt.plannedItems,
    "Zotero sync planned items",
    RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS,
  ).map((entry, index) =>
    parsePreviewItem(entry, selection, `Zotero sync planned item ${index + 1}`),
  );
  const plannedByIdentity = new Map(
    plannedItems.map((item) => [
      researchWorkspaceZoteroItemIdentityKey(item),
      item,
    ]),
  );
  if (plannedByIdentity.size !== plannedItems.length) {
    throw new Error("Zotero sync receipt contains duplicate planned items.");
  }

  const applyResults = receipt.applyResults
    ? boundedArray(
        receipt.applyResults,
        "Zotero sync apply results",
        RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS,
      ).map((entry, index) =>
        parseApplyResult(entry, `Zotero sync apply result ${index + 1}`),
      )
    : undefined;
  const applyByIdentity = new Map<
    string,
    ResearchWorkspaceZoteroSyncApplyItemResult
  >();
  for (const result of applyResults ?? []) {
    const key = researchWorkspaceZoteroItemIdentityKey(result);
    const plan = plannedByIdentity.get(key);
    if (!plan || applyByIdentity.has(key)) {
      throw new Error(`Invalid Zotero sync apply result identity ${key}.`);
    }
    validateApplyResultAgainstPlan(plan, result, selection);
    applyByIdentity.set(key, result);
  }

  const committedStatus =
    receipt.status === "committed" ||
    receipt.status === "partially-undone" ||
    receipt.status === "undone";
  if (
    committedStatus &&
    (!applyResults || applyResults.length !== plannedItems.length)
  ) {
    throw new Error(
      "Committed Zotero sync receipts require one result for every preview item.",
    );
  }
  if (!committedStatus && applyResults) {
    throw new Error("Only committed Zotero sync receipts may own additions.");
  }

  const undoResults = receipt.undoResults
    ? boundedArray(
        receipt.undoResults,
        "Zotero sync undo results",
        RESEARCH_WORKSPACE_ZOTERO_SYNC_MAX_ITEMS,
      ).map((entry, index) =>
        parseUndoResult(entry, `Zotero sync undo result ${index + 1}`),
      )
    : undefined;
  const undoIdentities = new Set<string>();
  const undoByIdentity = new Map<
    string,
    ResearchWorkspaceZoteroSyncUndoItemResult
  >();
  for (const result of undoResults ?? []) {
    const key = researchWorkspaceZoteroItemIdentityKey(result);
    const owned = applyByIdentity.get(key);
    if (!owned || undoIdentities.has(key)) {
      throw new Error(`Invalid Zotero sync undo result identity ${key}.`);
    }
    undoIdentities.add(key);
    undoByIdentity.set(key, result);
    if (result.collectionRemoved && !owned.collectionAdded) {
      throw new Error(
        `Zotero sync undo removed an unowned collection for ${key}.`,
      );
    }
    const ownedTags = new Set(owned.tagNamesAdded);
    if (result.tagNamesRemoved.some((tagName) => !ownedTags.has(tagName))) {
      throw new Error(`Zotero sync undo removed an unowned tag for ${key}.`);
    }
  }
  if (
    (receipt.status === "partially-undone" || receipt.status === "undone") &&
    (!undoResults || undoResults.length !== applyResults?.length)
  ) {
    throw new Error(
      "Undo receipts require one result for every committed preview item.",
    );
  }
  if (
    receipt.status === "partially-undone" ||
    receipt.status === "undone"
  ) {
    const allOwnershipCleared = (applyResults ?? []).every((applied) => {
      if (!applied.collectionAdded && !applied.tagNamesAdded.length) return true;
      const undone = undoByIdentity.get(
        researchWorkspaceZoteroItemIdentityKey(applied),
      );
      return undone?.status === "undone" || undone?.status === "no-op";
    });
    if (receipt.status === "undone" && !allOwnershipCleared) {
      throw new Error(
        "An undone Zotero sync receipt must clear every receipt-owned addition.",
      );
    }
    if (receipt.status === "partially-undone" && allOwnershipCleared) {
      throw new Error(
        "A partially-undone Zotero sync receipt must retain at least one owned addition for retry.",
      );
    }
  }
  if (
    receipt.status !== "partially-undone" &&
    receipt.status !== "undone" &&
    undoResults
  ) {
    throw new Error("This Zotero sync receipt cannot contain undo results.");
  }

  isoDate(receipt.createdAt, "Zotero sync receipt createdAt");
  isoDate(receipt.updatedAt, "Zotero sync receipt updatedAt");
  if (receipt.committedAt !== undefined) {
    isoDate(receipt.committedAt, "Zotero sync receipt committedAt");
  }
  if (receipt.undoneAt !== undefined) {
    isoDate(receipt.undoneAt, "Zotero sync receipt undoneAt");
  }
  if (committedStatus && receipt.committedAt === undefined) {
    throw new Error("Committed Zotero sync receipts require committedAt.");
  }
  if (!committedStatus && receipt.committedAt !== undefined) {
    throw new Error(
      "An uncommitted Zotero sync receipt cannot have committedAt.",
    );
  }
  if (receipt.status === "undone" && receipt.undoneAt === undefined) {
    throw new Error("An undone Zotero sync receipt requires undoneAt.");
  }
  if (receipt.status !== "undone" && receipt.undoneAt !== undefined) {
    throw new Error("Only an undone Zotero sync receipt may have undoneAt.");
  }
  const error = optionalText(receipt.error, "Zotero sync receipt error", 1_000);
  if (receipt.status === "failed" && !error) {
    throw new Error("A failed Zotero sync receipt requires an error.");
  }
  if (receipt.status !== "failed" && error) {
    throw new Error("Only a failed Zotero sync receipt may contain an error.");
  }
  return clone(value) as ResearchWorkspaceZoteroSyncReceiptFile;
}

export function fingerprintResearchWorkspaceZoteroSyncApprovalToken(
  approvalToken: string,
) {
  return fingerprint(
    "paperpilot-zotero-sync-approval-token-v1",
    requiredText(approvalToken, "Zotero sync approval token", 500),
  );
}
