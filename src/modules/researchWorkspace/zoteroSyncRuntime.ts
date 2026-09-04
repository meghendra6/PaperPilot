import {
  RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION,
  fingerprintResearchWorkspaceZoteroSyncObservedState,
  parseResearchWorkspaceZoteroSyncReceiptFile,
  researchWorkspaceZoteroItemIdentityKey,
  type ResearchWorkspaceZoteroCollectionIdentity,
  type ResearchWorkspaceZoteroItemIdentity,
  type ResearchWorkspaceZoteroItemKind,
  type ResearchWorkspaceZoteroSyncApplyItemResult,
  type ResearchWorkspaceZoteroSyncObservedState,
  type ResearchWorkspaceZoteroSyncPreview,
  type ResearchWorkspaceZoteroSyncReceipt,
  type ResearchWorkspaceZoteroSyncSelection,
  type ResearchWorkspaceZoteroSyncTargets,
  type ResearchWorkspaceZoteroSyncUndoItemResult,
} from "./zoteroSync";

interface ZoteroSyncItem {
  id?: unknown;
  libraryID?: unknown;
  key?: unknown;
  version?: unknown;
  isAttachment?: () => boolean;
  isAnnotation?: () => boolean;
  isNote?: () => boolean;
  isRegularItem?: () => boolean;
  getField?: (field: string) => unknown;
  getCollections?: () => unknown;
  getTags?: () => unknown;
  addTag?: (tagName: string) => unknown;
  removeTag?: (tagName: string) => unknown;
  save?: (options?: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ZoteroSyncCollection {
  id?: unknown;
  libraryID?: unknown;
  key?: unknown;
  name?: unknown;
  version?: unknown;
  addItem?: (itemID: number, options?: Record<string, unknown>) => unknown;
  addItems?: (itemIDs: number[], options?: Record<string, unknown>) => unknown;
  removeItem?: (itemID: number, options?: Record<string, unknown>) => unknown;
  removeItems?: (
    itemIDs: number[],
    options?: Record<string, unknown>,
  ) => unknown;
}

interface ZoteroSyncRuntimeGlobals {
  DB?: {
    executeTransaction?: <T>(action: () => Promise<T>) => Promise<T>;
  };
  Items?: {
    getByLibraryAndKeyAsync?: (
      libraryID: number,
      itemKey: string,
    ) => Promise<unknown>;
    getByLibraryAndKey?: (libraryID: number, itemKey: string) => unknown;
  };
  Collections?: {
    getByLibraryAndKeyAsync?: (
      libraryID: number,
      collectionKey: string,
    ) => Promise<unknown>;
    getByLibraryAndKey?: (libraryID: number, collectionKey: string) => unknown;
    getByLibrary?: (libraryID: number) => Promise<unknown> | unknown;
    get?: (id: number) => unknown;
  };
  Tags?: {
    getAll?: (libraryID: number) => Promise<unknown> | unknown;
  };
}

export interface ResearchWorkspaceZoteroSyncRuntime {
  listTargets(
    libraryIDs: readonly number[],
  ): Promise<ResearchWorkspaceZoteroSyncTargets>;
  observe(
    selection: ResearchWorkspaceZoteroSyncSelection,
    items: readonly ResearchWorkspaceZoteroItemIdentity[],
  ): Promise<ResearchWorkspaceZoteroSyncObservedState>;
  apply(
    preview: ResearchWorkspaceZoteroSyncPreview,
    receiptID: string,
  ): Promise<ResearchWorkspaceZoteroSyncApplyItemResult[]>;
  undo(
    receipt: ResearchWorkspaceZoteroSyncReceipt,
  ): Promise<ResearchWorkspaceZoteroSyncUndoItemResult[]>;
}

function runtimeGlobals(): ZoteroSyncRuntimeGlobals | undefined {
  return (
    globalThis as typeof globalThis & { Zotero?: ZoteroSyncRuntimeGlobals }
  ).Zotero;
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function tagText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0
    ? normalized
    : undefined;
}

function positiveInteger(value: unknown) {
  const normalized = integer(value);
  return normalized && normalized > 0 ? normalized : undefined;
}

function values(value: unknown) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function uniqueTexts(entries: readonly string[]) {
  return [...new Set(entries.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function uniqueTagNames(entries: readonly string[]) {
  return [...new Set(entries.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function sameTexts(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function classifyItem(item: ZoteroSyncItem): ResearchWorkspaceZoteroItemKind {
  try {
    if (item.isAttachment?.()) return "attachment";
    if (item.isAnnotation?.()) return "annotation";
    if (item.isNote?.()) return "note";
    if (item.isRegularItem?.()) return "regular-item";
    if (
      typeof item.isAttachment === "function" &&
      typeof item.isNote === "function" &&
      item.isAttachment() === false &&
      item.isNote() === false &&
      (typeof item.isAnnotation !== "function" || item.isAnnotation() === false)
    ) {
      return "regular-item";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

async function resolveItem(
  runtime: ZoteroSyncRuntimeGlobals,
  identity: ResearchWorkspaceZoteroItemIdentity,
) {
  let candidate: unknown;
  if (runtime.Items?.getByLibraryAndKeyAsync) {
    try {
      candidate = await runtime.Items.getByLibraryAndKeyAsync(
        identity.libraryID,
        identity.itemKey,
      );
    } catch {
      // Fall through to the synchronous compatibility API.
    }
  }
  if (!candidate && runtime.Items?.getByLibraryAndKey) {
    candidate = runtime.Items.getByLibraryAndKey(
      identity.libraryID,
      identity.itemKey,
    );
  }
  if (!candidate || typeof candidate !== "object") return undefined;
  const item = candidate as ZoteroSyncItem;
  if (
    integer(item.libraryID) !== identity.libraryID ||
    text(item.key) !== identity.itemKey
  ) {
    return undefined;
  }
  return item;
}

function collectionFromValue(
  runtime: ZoteroSyncRuntimeGlobals,
  value: unknown,
) {
  if (value && typeof value === "object") return value as ZoteroSyncCollection;
  const id = positiveInteger(value);
  const candidate = id ? runtime.Collections?.get?.(id) : undefined;
  return candidate && typeof candidate === "object"
    ? (candidate as ZoteroSyncCollection)
    : undefined;
}

async function resolveCollection(
  runtime: ZoteroSyncRuntimeGlobals,
  identity: ResearchWorkspaceZoteroCollectionIdentity,
) {
  let candidate: unknown;
  if (runtime.Collections?.getByLibraryAndKeyAsync) {
    try {
      candidate = await runtime.Collections.getByLibraryAndKeyAsync(
        identity.libraryID,
        identity.collectionKey,
      );
    } catch {
      // Fall through to compatibility APIs.
    }
  }
  if (!candidate && runtime.Collections?.getByLibraryAndKey) {
    candidate = runtime.Collections.getByLibraryAndKey(
      identity.libraryID,
      identity.collectionKey,
    );
  }
  if (!candidate && runtime.Collections?.getByLibrary) {
    const libraryCollections = await Promise.resolve(
      runtime.Collections.getByLibrary(identity.libraryID),
    );
    candidate = values(libraryCollections)
      .map((value) => collectionFromValue(runtime, value))
      .find((collection) => text(collection?.key) === identity.collectionKey);
  }
  const collection = collectionFromValue(runtime, candidate);
  if (
    !collection ||
    integer(collection.libraryID) !== identity.libraryID ||
    text(collection.key) !== identity.collectionKey
  ) {
    return undefined;
  }
  return collection;
}

function collectionKeys(
  runtime: ZoteroSyncRuntimeGlobals,
  item: ZoteroSyncItem,
) {
  return uniqueTexts(
    values(item.getCollections?.()).map((value) => {
      if (typeof value === "string" && value.trim() && !/^\d+$/.test(value)) {
        return value.trim();
      }
      return text(collectionFromValue(runtime, value)?.key);
    }),
  );
}

function tagNames(item: ZoteroSyncItem) {
  return uniqueTagNames(
    values(item.getTags?.()).map((entry) =>
      typeof entry === "string"
        ? tagText(entry)
        : entry && typeof entry === "object"
          ? tagText((entry as { tag?: unknown }).tag)
          : "",
    ),
  );
}

async function existingTagNames(
  runtime: ZoteroSyncRuntimeGlobals,
  libraryID: number,
) {
  const entries = await Promise.resolve(runtime.Tags?.getAll?.(libraryID));
  return uniqueTagNames(
    values(entries).map((entry) =>
      typeof entry === "string"
        ? tagText(entry)
        : entry && typeof entry === "object"
          ? tagText(
              (entry as { tag?: unknown; name?: unknown }).tag ??
                (entry as { name?: unknown }).name,
            )
          : "",
    ),
  );
}

function runtimeItemID(item: ZoteroSyncItem) {
  const id = positiveInteger(item.id);
  if (!id) throw new Error("The stable Zotero item has no runtime ID.");
  return id;
}

function transactionExecutor(runtime: ZoteroSyncRuntimeGlobals) {
  const database = runtime.DB;
  if (!database?.executeTransaction) {
    throw new Error(
      "Safe Zotero sync is unavailable because Zotero.DB.executeTransaction is missing.",
    );
  }
  return <T>(action: () => Promise<T>) => database.executeTransaction!(action);
}

function notifierData(receiptID: string, action: "apply" | "undo") {
  return {
    paperPilotOrigin: "research-workspace-zotero-sync",
    paperPilotSyncReceiptID: receiptID,
    paperPilotSyncAction: action,
  };
}

async function addCollectionItem(
  collection: ZoteroSyncCollection,
  itemID: number,
  options: Record<string, unknown>,
) {
  if (collection.addItem) {
    await Promise.resolve(collection.addItem(itemID, options));
    return;
  }
  if (collection.addItems) {
    await Promise.resolve(collection.addItems([itemID], options));
    return;
  }
  throw new Error("The existing Zotero collection cannot accept items.");
}

async function removeCollectionItem(
  collection: ZoteroSyncCollection,
  itemID: number,
  options: Record<string, unknown>,
) {
  if (collection.removeItem) {
    await Promise.resolve(collection.removeItem(itemID, options));
    return;
  }
  if (collection.removeItems) {
    await Promise.resolve(collection.removeItems([itemID], options));
    return;
  }
  throw new Error("The existing Zotero collection cannot remove items.");
}

function expectedAfterState(
  preview: ResearchWorkspaceZoteroSyncPreview,
  item: ResearchWorkspaceZoteroSyncPreview["items"][number],
) {
  return {
    collectionKeys: uniqueTexts([
      ...item.beforeCollectionKeys,
      ...(item.addCollection && preview.selection.collectionKey
        ? [preview.selection.collectionKey]
        : []),
    ]),
    tagNames: uniqueTexts([...item.beforeTagNames, ...item.addTagNames]),
  };
}

export function createResearchWorkspaceZoteroSyncRuntime(
  injected: ZoteroSyncRuntimeGlobals | undefined = runtimeGlobals(),
): ResearchWorkspaceZoteroSyncRuntime {
  const runtime = injected;

  const observe: ResearchWorkspaceZoteroSyncRuntime["observe"] = async (
    selection,
    identities,
  ) => {
    if (!runtime) throw new Error("Zotero runtime APIs are unavailable.");
    const collection = selection.collectionKey
      ? await resolveCollection(runtime, {
          libraryID: selection.libraryID,
          collectionKey: selection.collectionKey,
        })
      : undefined;
    const items = [];
    for (const identity of identities) {
      const item = await resolveItem(runtime, identity);
      const kind = item ? classifyItem(item) : "unknown";
      const title = item?.getField ? text(item.getField("title")) : "";
      const version = item ? integer(item.version) : undefined;
      items.push({
        ...identity,
        ...(title ? { title } : {}),
        ...(version !== undefined ? { version } : {}),
        itemKind: kind,
        eligibleForAdditiveSync: kind === "regular-item",
        collectionKeys: item ? collectionKeys(runtime, item) : [],
        tagNames: item ? tagNames(item) : [],
        available: Boolean(item),
      });
    }
    return {
      libraryID: selection.libraryID,
      ...(collection
        ? {
            collection: {
              libraryID: selection.libraryID,
              collectionKey: text(collection.key),
              name: text(collection.name) || text(collection.key),
              ...(integer(collection.version) !== undefined
                ? { version: integer(collection.version) }
                : {}),
            },
          }
        : {}),
      existingTagNames: await existingTagNames(runtime, selection.libraryID),
      items,
    };
  };

  return {
    async listTargets(libraryIDs) {
      if (!runtime) throw new Error("Zotero runtime APIs are unavailable.");
      const libraries: ResearchWorkspaceZoteroSyncTargets["libraries"] = [];
      for (const libraryID of [...new Set(libraryIDs)].sort(
        (left, right) => left - right,
      )) {
        const raw = await Promise.resolve(
          runtime.Collections?.getByLibrary?.(libraryID),
        );
        const collections = values(raw)
          .map((value) => collectionFromValue(runtime, value))
          .filter((collection): collection is ZoteroSyncCollection =>
            Boolean(
              collection &&
                integer(collection.libraryID) === libraryID &&
                text(collection.key),
            ),
          )
          .map((collection) => ({
            libraryID,
            collectionKey: text(collection.key),
            name: text(collection.name) || text(collection.key),
            ...(integer(collection.version) !== undefined
              ? { version: integer(collection.version) }
              : {}),
          }))
          .sort((left, right) =>
            left.name === right.name
              ? left.collectionKey.localeCompare(right.collectionKey)
              : left.name.localeCompare(right.name),
          );
        libraries.push({
          libraryID,
          collections,
          tagNames: await existingTagNames(runtime, libraryID),
        });
      }
      return {
        libraries,
        limitations: [
          "Only existing Zotero collections and tags are available; sync never creates collections, tags, items, attachments, notes, or annotations.",
          "Only regular bibliographic items are eligible. Attachment, annotation, note, unknown, missing, and cross-library identities are blocked in the full preview.",
          "Apply and undo fail closed when Zotero.DB.executeTransaction is unavailable.",
        ],
      };
    },

    observe,

    async apply(preview, receiptID) {
      if (!runtime) throw new Error("Zotero runtime APIs are unavailable.");
      const executeTransaction = transactionExecutor(runtime);
      return executeTransaction(async () => {
        const identities = preview.items.map((item) => ({
          libraryID: item.libraryID,
          itemKey: item.itemKey,
        }));
        const before = await observe(preview.selection, identities);
        if (
          fingerprintResearchWorkspaceZoteroSyncObservedState(before) !==
          preview.observedStateFingerprint
        ) {
          throw new Error(
            "The Zotero sync preview is stale. Review a newly generated preview before applying changes.",
          );
        }
        const collection = preview.selection.collectionKey
          ? await resolveCollection(runtime, {
              libraryID: preview.selection.libraryID,
              collectionKey: preview.selection.collectionKey,
            })
          : undefined;
        if (preview.selection.collectionKey && !collection) {
          throw new Error("The selected Zotero collection no longer exists.");
        }
        const options = {
          skipDateModifiedUpdate: true,
          notifierData: notifierData(receiptID, "apply"),
        };
        for (const plan of preview.items) {
          if (plan.status !== "additive") continue;
          const item = await resolveItem(runtime, plan);
          if (!item || classifyItem(item) !== "regular-item") {
            throw new Error(
              `Zotero item ${researchWorkspaceZoteroItemIdentityKey(plan)} is no longer an eligible regular item.`,
            );
          }
          if (plan.addCollection) {
            if (!collection)
              throw new Error("The selected collection is missing.");
            await addCollectionItem(collection, runtimeItemID(item), options);
          }
          if (plan.addTagNames.length) {
            if (!item.addTag || !item.save) {
              throw new Error(
                "The Zotero item does not support transactional tag associations.",
              );
            }
            for (const tagName of plan.addTagNames) {
              await Promise.resolve(item.addTag(tagName));
            }
            await Promise.resolve(item.save(options));
          }
        }

        const after = await observe(preview.selection, identities);
        const afterByIdentity = new Map(
          after.items.map((item) => [
            researchWorkspaceZoteroItemIdentityKey(item),
            item,
          ]),
        );
        return preview.items.map((plan) => {
          const current = afterByIdentity.get(
            researchWorkspaceZoteroItemIdentityKey(plan),
          );
          if (!current) {
            throw new Error(
              "A Zotero item disappeared during the transaction.",
            );
          }
          if (plan.status === "additive") {
            const expected = expectedAfterState(preview, plan);
            if (
              current.itemKind !== "regular-item" ||
              !sameTexts(current.collectionKeys, expected.collectionKeys) ||
              !sameTexts(current.tagNames, expected.tagNames)
            ) {
              throw new Error(
                `Zotero item ${researchWorkspaceZoteroItemIdentityKey(plan)} did not reach the exact approved additive state.`,
              );
            }
          } else if (
            !sameTexts(current.collectionKeys, plan.beforeCollectionKeys) ||
            !sameTexts(current.tagNames, plan.beforeTagNames)
          ) {
            throw new Error(
              `A blocked or no-op Zotero item changed during the transaction.`,
            );
          }
          const changed = plan.status === "additive";
          return {
            libraryID: plan.libraryID,
            itemKey: plan.itemKey,
            status:
              plan.status === "additive"
                ? "applied"
                : plan.status === "blocked"
                  ? "blocked"
                  : "no-op",
            collectionAdded: changed && plan.addCollection,
            tagNamesAdded: changed ? [...plan.addTagNames] : [],
            afterCollectionKeys: [...current.collectionKeys],
            afterTagNames: [...current.tagNames],
            ...(current.version !== undefined
              ? { versionAfter: current.version }
              : {}),
            notifierDataIncluded: changed,
            ...(plan.blockedReason ? { message: plan.blockedReason } : {}),
          } satisfies ResearchWorkspaceZoteroSyncApplyItemResult;
        });
      });
    },

    async undo(receipt) {
      if (!runtime) throw new Error("Zotero runtime APIs are unavailable.");
      parseResearchWorkspaceZoteroSyncReceiptFile({
        schemaVersion: RESEARCH_WORKSPACE_ZOTERO_SYNC_SCHEMA_VERSION,
        revision: 1,
        receipt,
      });
      const applyResults = receipt.applyResults;
      if (!applyResults) {
        throw new Error(
          "This write-ahead receipt has no committed per-item ownership results and cannot be undone safely.",
        );
      }
      const executeTransaction = transactionExecutor(runtime);
      return executeTransaction(async () => {
        const options = {
          skipDateModifiedUpdate: true,
          notifierData: notifierData(receipt.receiptID, "undo"),
        };
        const priorUndoByIdentity = new Map(
          (receipt.undoResults ?? []).map((result) => [
            researchWorkspaceZoteroItemIdentityKey(result),
            result,
          ]),
        );
        const plannedByIdentity = new Map(
          receipt.plannedItems.map((plan) => [
            researchWorkspaceZoteroItemIdentityKey(plan),
            plan,
          ]),
        );
        const alreadySettled = new Set<string>();
        const undoBaselines = new Map<
          string,
          { collectionKeys: string[]; tagNames: string[] }
        >();
        const results: ResearchWorkspaceZoteroSyncUndoItemResult[] = [];
        for (const owned of applyResults) {
          const identity = researchWorkspaceZoteroItemIdentityKey(owned);
          const priorUndo = priorUndoByIdentity.get(identity);
          if (priorUndo?.status === "undone" || priorUndo?.status === "no-op") {
            alreadySettled.add(identity);
            results.push(structuredClone(priorUndo));
            continue;
          }
          if (!owned.collectionAdded && !owned.tagNamesAdded.length) {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: owned.status === "blocked" ? "blocked" : "no-op",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              ...(owned.message ? { message: owned.message } : {}),
            });
            continue;
          }
          const plan = plannedByIdentity.get(identity);
          if (!plan) {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: "failed",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              message:
                "The receipt no longer contains this item's approved plan.",
            });
            continue;
          }
          const item = await resolveItem(runtime, owned);
          if (!item) {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: "failed",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              message: "The receipt-owned Zotero item no longer resolves.",
            });
            continue;
          }
          if (classifyItem(item) !== "regular-item") {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: "blocked",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              message:
                "The receipt-owned identity no longer resolves to a regular bibliographic item.",
            });
            continue;
          }
          const currentCollections = collectionKeys(runtime, item);
          const currentTags = tagNames(item);
          undoBaselines.set(identity, {
            collectionKeys: [...currentCollections],
            tagNames: [...currentTags],
          });
          const collectionPresent = Boolean(
            owned.collectionAdded &&
              receipt.selection.collectionKey &&
              currentCollections.includes(receipt.selection.collectionKey),
          );
          const tagsPresent = owned.tagNamesAdded.filter((tagName) =>
            currentTags.includes(tagName),
          );
          if (!collectionPresent && !tagsPresent.length) {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: "no-op",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              message:
                "The receipt-owned additions were already absent; no unrelated state was changed.",
            });
            continue;
          }

          const collection = collectionPresent
            ? await resolveCollection(runtime, {
                libraryID: receipt.selection.libraryID,
                collectionKey: receipt.selection.collectionKey!,
              })
            : undefined;
          if (collectionPresent && !collection) {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: "blocked",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              message:
                "The original collection is unavailable; receipt-owned additions were preserved.",
            });
            continue;
          }
          const removeTag = item.removeTag;
          const save = item.save;
          if (tagsPresent.length && (!removeTag || !save)) {
            results.push({
              libraryID: owned.libraryID,
              itemKey: owned.itemKey,
              status: "blocked",
              collectionRemoved: false,
              tagNamesRemoved: [],
              notifierDataIncluded: false,
              message:
                "The Zotero item does not support transactional removal of its receipt-owned tag associations.",
            });
            continue;
          }

          let collectionRemoved = false;
          const tagNamesRemoved: string[] = [];
          if (collectionPresent) {
            if (!collection) {
              throw new Error(
                "The selected collection disappeared during the undo transaction.",
              );
            }
            await removeCollectionItem(
              collection,
              runtimeItemID(item),
              options,
            );
            collectionRemoved = true;
          }
          if (tagsPresent.length) {
            for (const tagName of tagsPresent) {
              await Promise.resolve(removeTag!(tagName));
              tagNamesRemoved.push(tagName);
            }
            await Promise.resolve(save!(options));
          }
          results.push({
            libraryID: owned.libraryID,
            itemKey: owned.itemKey,
            status: "undone",
            collectionRemoved,
            tagNamesRemoved,
            notifierDataIncluded: true,
          });
        }

        const identities = applyResults.map((result) => ({
          libraryID: result.libraryID,
          itemKey: result.itemKey,
        }));
        const after = await observe(receipt.selection, identities);
        const afterByIdentity = new Map(
          after.items.map((item) => [
            researchWorkspaceZoteroItemIdentityKey(item),
            item,
          ]),
        );
        for (const owned of applyResults) {
          if (!owned.collectionAdded && !owned.tagNamesAdded.length) continue;
          const identity = researchWorkspaceZoteroItemIdentityKey(owned);
          if (alreadySettled.has(identity)) continue;
          const result = results.find(
            (candidate) =>
              researchWorkspaceZoteroItemIdentityKey(candidate) === identity,
          );
          if (result?.status !== "undone" && result?.status !== "no-op") {
            continue;
          }
          const baseline = undoBaselines.get(identity);
          const current = afterByIdentity.get(identity);
          if (!baseline || !current) {
            throw new Error(
              `Zotero item ${identity} disappeared while receipt-owned additions were being verified.`,
            );
          }
          const removedCollectionKeys = new Set(
            result.collectionRemoved && receipt.selection.collectionKey
              ? [receipt.selection.collectionKey]
              : [],
          );
          const removedTagNames = new Set(result.tagNamesRemoved);
          if (
            [...removedCollectionKeys].some((collectionKey) =>
              current.collectionKeys.includes(collectionKey),
            ) ||
            [...removedTagNames].some((tagName) =>
              current.tagNames.includes(tagName),
            ) ||
            baseline.collectionKeys.some(
              (collectionKey) =>
                !removedCollectionKeys.has(collectionKey) &&
                !current.collectionKeys.includes(collectionKey),
            ) ||
            baseline.tagNames.some(
              (tagName) =>
                !removedTagNames.has(tagName) &&
                !current.tagNames.includes(tagName),
            )
          ) {
            throw new Error(
              `Zotero item ${identity} did not preserve the exact receipt ownership boundary during undo.`,
            );
          }
        }
        return results;
      });
    },
  };
}
