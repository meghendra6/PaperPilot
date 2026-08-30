import {
  buildResearchWorkspaceZoteroSyncPreview,
  fingerprintResearchWorkspaceZoteroSyncApprovalToken,
  fingerprintResearchWorkspaceZoteroSyncObservedState,
  fingerprintResearchWorkspaceZoteroSyncPreview,
  normalizeResearchWorkspaceZoteroSyncSelection,
  parseResearchWorkspaceZoteroSyncPreview,
  researchWorkspaceZoteroItemIdentityKey,
  verifyResearchWorkspaceZoteroSyncApproval,
  type ResearchWorkspaceZoteroItemIdentity,
  type ResearchWorkspaceZoteroSyncApplyItemResult,
  type ResearchWorkspaceZoteroSyncPreview,
  type ResearchWorkspaceZoteroSyncReceipt,
  type ResearchWorkspaceZoteroSyncSelection,
  type ResearchWorkspaceZoteroSyncUndoItemResult,
} from "./zoteroSync";
import {
  createResearchWorkspaceZoteroSyncRuntime,
  type ResearchWorkspaceZoteroSyncRuntime,
} from "./zoteroSyncRuntime";
import { ResearchWorkspaceProjectRepository } from "./persistence/projectRepository";
import { ResearchWorkspaceRevisionConflictError } from "./persistence/contracts";

export interface ResearchWorkspaceZoteroSyncServiceOptions {
  runtime?: ResearchWorkspaceZoteroSyncRuntime;
  now?: () => Date;
  idFactory?: (prefix: string) => string;
}

function defaultID(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s"']+/g, "[local-path]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function identityKey(identity: ResearchWorkspaceZoteroItemIdentity) {
  return researchWorkspaceZoteroItemIdentityKey(identity);
}

function hasOwnedAdditions(result: ResearchWorkspaceZoteroSyncApplyItemResult) {
  return result.collectionAdded || result.tagNamesAdded.length > 0;
}

function ownershipCleared(
  applyResult: ResearchWorkspaceZoteroSyncApplyItemResult,
  undoResult: ResearchWorkspaceZoteroSyncUndoItemResult | undefined,
) {
  if (!hasOwnedAdditions(applyResult)) return true;
  return undoResult?.status === "undone" || undoResult?.status === "no-op";
}

export class ResearchWorkspaceZoteroSyncService {
  private readonly runtime: ResearchWorkspaceZoteroSyncRuntime;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly operationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: ResearchWorkspaceProjectRepository,
    options: ResearchWorkspaceZoteroSyncServiceOptions = {},
  ) {
    this.runtime =
      options.runtime ?? createResearchWorkspaceZoteroSyncRuntime();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultID;
  }

  private timestamp() {
    return this.now().toISOString();
  }

  private async exclusive<T>(projectID: string, action: () => Promise<T>) {
    const previous = this.operationQueues.get(projectID) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.operationQueues.set(projectID, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.operationQueues.get(projectID) === queued) {
        this.operationQueues.delete(projectID);
      }
    }
  }

  private async updateReceiptWithRetry(
    projectID: string,
    receiptID: string,
    mutate: (
      receipt: ResearchWorkspaceZoteroSyncReceipt,
    ) => ResearchWorkspaceZoteroSyncReceipt,
  ) {
    let conflict: ResearchWorkspaceRevisionConflictError | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.repository.getZoteroSyncReceipt(
        projectID,
        receiptID,
      );
      if (!current) {
        throw new Error(`Zotero sync receipt ${receiptID} disappeared.`);
      }
      try {
        return await this.repository.updateZoteroSyncReceipt(
          projectID,
          receiptID,
          current.revision,
          mutate,
        );
      } catch (error) {
        if (!(error instanceof ResearchWorkspaceRevisionConflictError)) {
          throw error;
        }
        conflict = error;
      }
    }
    throw (
      conflict ??
      new Error(`Zotero sync receipt ${receiptID} could not be updated.`)
    );
  }

  private async projectSources(projectID: string) {
    const bundle = await this.repository.getProject(projectID);
    const sources = [];
    for (const member of bundle.members) {
      const file = await this.repository.getSource(member.sourceID);
      if (!file) {
        throw new Error(
          `Safe Zotero sync cannot resolve project source ${member.sourceID}.`,
        );
      }
      sources.push(file.source);
    }
    return { bundle, sources };
  }

  async listTargets(projectID: string) {
    const { sources } = await this.projectSources(projectID);
    const libraryIDs = [
      ...new Set(sources.map((source) => source.identity.libraryID)),
    ].sort((left, right) => left - right);
    return this.runtime.listTargets(libraryIDs);
  }

  async preview(params: {
    projectID: string;
    selection: ResearchWorkspaceZoteroSyncSelection;
  }) {
    const { bundle, sources } = await this.projectSources(params.projectID);
    const selection = normalizeResearchWorkspaceZoteroSyncSelection(
      params.selection,
    );
    const identities = [
      ...new Map(
        sources.map((source) => {
          const identity = {
            libraryID: source.identity.libraryID,
            itemKey: source.identity.itemKey,
          };
          return [identityKey(identity), identity] as const;
        }),
      ).values(),
    ].sort((left, right) =>
      identityKey(left).localeCompare(identityKey(right)),
    );
    const observedState = await this.runtime.observe(selection, identities);
    return buildResearchWorkspaceZoteroSyncPreview({
      projectID: params.projectID,
      membersRevision: bundle.membersRevision,
      sources,
      selection,
      observedState,
      previewID: this.idFactory("zotero-sync-preview"),
      createdAt: this.timestamp(),
    });
  }

  private async markReceiptFailed(
    projectID: string,
    receiptID: string,
    error: unknown,
  ) {
    const failedAt = this.timestamp();
    return this.updateReceiptWithRetry(projectID, receiptID, (receipt) => ({
      ...receipt,
      status: "failed",
      applyResults: undefined,
      undoResults: undefined,
      committedAt: undefined,
      undoneAt: undefined,
      error: safeError(error),
      updatedAt: failedAt,
    }));
  }

  private async compensateUnfinalizedApply(params: {
    prepared: ResearchWorkspaceZoteroSyncReceipt;
    applyResults: ResearchWorkspaceZoteroSyncApplyItemResult[];
    committedAt: string;
  }) {
    const syntheticCommitted: ResearchWorkspaceZoteroSyncReceipt = {
      ...clone(params.prepared),
      status: "committed",
      applyResults: clone(params.applyResults),
      updatedAt: params.committedAt,
      committedAt: params.committedAt,
    };
    return this.runtime.undo(syntheticCommitted);
  }

  private async applyOnce(params: {
    preview: ResearchWorkspaceZoteroSyncPreview;
    approvalToken: string;
  }) {
    const preview = parseResearchWorkspaceZoteroSyncPreview(params.preview);
    const approvalToken = verifyResearchWorkspaceZoteroSyncApproval(
      preview,
      params.approvalToken,
    );
    const { bundle, sources } = await this.projectSources(preview.projectID);
    if (bundle.membersRevision !== preview.membersRevision) {
      throw new Error(
        "The project membership changed after this sync preview. Review a new preview.",
      );
    }
    const currentIdentityKeys = [
      ...new Set(
        sources.map((source) =>
          identityKey({
            libraryID: source.identity.libraryID,
            itemKey: source.identity.itemKey,
          }),
        ),
      ),
    ].sort();
    const previewIdentityKeys = preview.items
      .map((item) => identityKey(item))
      .sort();
    if (
      JSON.stringify(currentIdentityKeys) !==
      JSON.stringify(previewIdentityKeys)
    ) {
      throw new Error(
        "A stable Zotero source identity changed after this sync preview. Review a new preview.",
      );
    }
    const currentState = await this.runtime.observe(
      preview.selection,
      preview.items.map((item) => ({
        libraryID: item.libraryID,
        itemKey: item.itemKey,
      })),
    );
    if (
      fingerprintResearchWorkspaceZoteroSyncObservedState(currentState) !==
      preview.observedStateFingerprint
    ) {
      throw new Error(
        "The Zotero library changed after this sync preview. Review a new preview before applying changes.",
      );
    }
    const previewFingerprint =
      fingerprintResearchWorkspaceZoteroSyncPreview(preview);
    const previous = (
      await this.repository.listZoteroSyncReceipts(preview.projectID)
    ).find(
      (file) =>
        file.receipt.previewFingerprint === previewFingerprint &&
        file.receipt.status !== "failed",
    );
    if (previous) {
      throw new Error(
        `This exact sync preview already has write-ahead receipt ${previous.receipt.receiptID}.`,
      );
    }

    const timestamp = this.timestamp();
    const receiptID = this.idFactory("zotero-sync-receipt");
    const prepared: ResearchWorkspaceZoteroSyncReceipt = {
      receiptID,
      projectID: preview.projectID,
      status: "prepared",
      membersRevision: preview.membersRevision,
      selection: clone(preview.selection),
      previewID: preview.previewID,
      previewFingerprint,
      approvalTokenFingerprint:
        fingerprintResearchWorkspaceZoteroSyncApprovalToken(approvalToken),
      observedStateFingerprint: preview.observedStateFingerprint,
      plannedItems: clone(preview.items),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.createZoteroSyncReceipt(preview.projectID, prepared);

    let applyResults: ResearchWorkspaceZoteroSyncApplyItemResult[];
    try {
      applyResults = await this.runtime.apply(preview, receiptID);
    } catch (error) {
      await this.markReceiptFailed(preview.projectID, receiptID, error);
      throw error;
    }

    const committedAt = this.timestamp();
    try {
      return await this.updateReceiptWithRetry(
        preview.projectID,
        receiptID,
        (receipt) => ({
          ...receipt,
          status: "committed",
          applyResults: clone(applyResults),
          updatedAt: committedAt,
          committedAt,
        }),
      );
    } catch (finalizationError) {
      let compensationResults:
        | ResearchWorkspaceZoteroSyncUndoItemResult[]
        | undefined;
      let compensationError: unknown;
      try {
        compensationResults = await this.compensateUnfinalizedApply({
          prepared,
          applyResults,
          committedAt,
        });
      } catch (error) {
        compensationError = error;
      }

      if (compensationResults) {
        const undoByIdentity = new Map(
          compensationResults.map((result) => [identityKey(result), result]),
        );
        const allOwnershipCleared = applyResults.every((result) =>
          ownershipCleared(result, undoByIdentity.get(identityKey(result))),
        );
        if (!allOwnershipCleared) {
          const recoveredAt = this.timestamp();
          try {
            await this.updateReceiptWithRetry(
              preview.projectID,
              receiptID,
              (receipt) => ({
                ...receipt,
                status: "partially-undone",
                applyResults: clone(applyResults),
                undoResults: clone(compensationResults!),
                error: undefined,
                updatedAt: recoveredAt,
                committedAt: receipt.committedAt ?? committedAt,
                undoneAt: undefined,
              }),
            );
          } catch (receiptRecoveryError) {
            throw new Error(
              `The Zotero transaction completed, receipt ${receiptID} could not be finalized, compensation was incomplete, and the ownership receipt could not be recovered. Do not reapply this preview. Finalization: ${safeError(
                finalizationError,
              )} Receipt recovery: ${safeError(receiptRecoveryError)}`,
            );
          }
          throw new Error(
            `The Zotero transaction completed, but receipt ${receiptID} could not be finalized and compensation cleared only part of the approved additions. Paper Pilot recovered the receipt as partially-undone; reload the project and retry receipt-owned undo. ${safeError(
              finalizationError,
            )}`,
          );
        }

        const recoveredAt = this.timestamp();
        try {
          await this.updateReceiptWithRetry(
            preview.projectID,
            receiptID,
            (receipt) => ({
              ...receipt,
              status: "undone",
              applyResults: clone(applyResults),
              undoResults: clone(compensationResults),
              error: undefined,
              updatedAt: recoveredAt,
              committedAt: receipt.committedAt ?? committedAt,
              undoneAt: recoveredAt,
            }),
          );
        } catch (receiptRecoveryError) {
          throw new Error(
            `The Zotero transaction completed and the approved additions were compensated, but receipt ${receiptID} could not record the per-item apply and undo results. Do not reapply this preview. Finalization: ${safeError(
              finalizationError,
            )} Receipt recovery: ${safeError(receiptRecoveryError)}`,
          );
        }
        throw new Error(
          `The Zotero transaction completed but receipt ${receiptID} could not be finalized, so Paper Pilot recorded the per-item results and rolled back the approved additions. ${safeError(
            finalizationError,
          )}`,
        );
      }

      const recoveredAt = this.timestamp();
      try {
        await this.updateReceiptWithRetry(
          preview.projectID,
          receiptID,
          (receipt) => ({
            ...receipt,
            status: "committed",
            applyResults: clone(applyResults),
            undoResults: undefined,
            error: undefined,
            updatedAt: recoveredAt,
            committedAt: receipt.committedAt ?? committedAt,
            undoneAt: undefined,
          }),
        );
      } catch (receiptRecoveryError) {
        throw new Error(
          `The Zotero transaction completed, but write-ahead receipt ${receiptID} could not be finalized, automatic compensation failed, and the ownership receipt could not be recovered. Do not reapply this preview. Finalization: ${safeError(
            finalizationError,
          )} Compensation: ${safeError(
            compensationError,
          )} Receipt recovery: ${safeError(receiptRecoveryError)}`,
        );
      }
      throw new Error(
        `The Zotero transaction completed and compensation failed, but Paper Pilot recovered receipt ${receiptID} with its committed ownership results. Reload the project and use receipt-owned undo; do not reapply this preview. ${safeError(
          compensationError,
        )}`,
      );
    }
  }

  apply(params: {
    preview: ResearchWorkspaceZoteroSyncPreview;
    approvalToken: string;
  }) {
    return this.exclusive(params.preview.projectID, () =>
      this.applyOnce(params),
    );
  }

  private async undoOnce(params: {
    projectID: string;
    receiptID: string;
    expectedRevision: number;
  }) {
    const file = await this.repository.getZoteroSyncReceipt(
      params.projectID,
      params.receiptID,
    );
    if (!file) {
      throw new Error(`Zotero sync receipt ${params.receiptID} was not found.`);
    }
    if (file.revision !== params.expectedRevision) {
      throw new Error(
        "The Zotero sync receipt changed before undo. Reload the receipt history.",
      );
    }
    if (file.receipt.status === "undone") return file;
    if (
      file.receipt.status !== "committed" &&
      file.receipt.status !== "partially-undone"
    ) {
      throw new Error(
        "Only a committed receipt with per-item ownership results can be undone.",
      );
    }
    const undoResults = await this.runtime.undo(file.receipt);
    const undoByIdentity = new Map(
      undoResults.map((result) => [identityKey(result), result]),
    );
    const allOwnershipCleared = (file.receipt.applyResults ?? []).every(
      (result) =>
        ownershipCleared(result, undoByIdentity.get(identityKey(result))),
    );
    const undoneAt = this.timestamp();
    try {
      return await this.updateReceiptWithRetry(
        params.projectID,
        params.receiptID,
        (receipt) => ({
          ...receipt,
          status: allOwnershipCleared ? "undone" : "partially-undone",
          undoResults: clone(undoResults),
          updatedAt: undoneAt,
          ...(allOwnershipCleared ? { undoneAt } : { undoneAt: undefined }),
        }),
      );
    } catch (error) {
      throw new Error(
        `The receipt-owned Zotero undo transaction completed, but receipt ${params.receiptID} could not be finalized. Reload before retrying. ${safeError(
          error,
        )}`,
      );
    }
  }

  undo(params: {
    projectID: string;
    receiptID: string;
    expectedRevision: number;
  }) {
    return this.exclusive(params.projectID, () => this.undoOnce(params));
  }

  listReceipts(projectID: string) {
    return this.repository.listZoteroSyncReceipts(projectID);
  }
}
