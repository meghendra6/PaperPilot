import type { EvidenceReferenceV2 } from "./evidenceVerification";
import { parseZoteroSourceID } from "./sourceIdentity";

export interface EvidenceNavigationDependencies {
  getByLibraryAndKey?: (
    libraryID: number,
    attachmentKey: string,
  ) => unknown | Promise<unknown>;
  openReader?: (
    attachmentID: number,
    options: { pageIndex?: number },
  ) => unknown | Promise<unknown>;
  viewAttachment?: (attachmentID: number) => unknown | Promise<unknown>;
}

function defaultDependencies(): EvidenceNavigationDependencies {
  const zotero = (globalThis as typeof globalThis & { Zotero?: any }).Zotero;
  return {
    getByLibraryAndKey: (libraryID, attachmentKey) =>
      zotero?.Items?.getByLibraryAndKey?.(libraryID, attachmentKey),
    openReader: zotero?.Reader?.open
      ? (attachmentID, options) => zotero.Reader.open(attachmentID, options)
      : undefined,
    viewAttachment: zotero?.getActiveZoteroPane?.()?.viewAttachment
      ? (attachmentID) =>
          zotero.getActiveZoteroPane().viewAttachment(attachmentID)
      : undefined,
  };
}

export async function openVerifiedResearchWorkspaceEvidence(
  reference: EvidenceReferenceV2,
  dependencies: EvidenceNavigationDependencies = defaultDependencies(),
) {
  if (reference?.verification?.status !== "verified") {
    throw new Error("Only locally verified evidence can be opened in the PDF.");
  }
  const identity = parseZoteroSourceID(reference.sourceID);
  if (
    !identity ||
    identity.libraryID !== reference.libraryID ||
    identity.attachmentKey !== reference.attachmentKey
  ) {
    throw new Error("The evidence source identity is invalid or stale.");
  }
  if (!dependencies.getByLibraryAndKey) {
    throw new Error("Library-scoped Zotero item lookup is unavailable.");
  }
  const attachment = (await Promise.resolve(
    dependencies.getByLibraryAndKey(
      reference.libraryID,
      reference.attachmentKey,
    ),
  )) as { id?: number; key?: string; libraryID?: number } | undefined;
  if (
    !attachment ||
    Number(attachment.libraryID) !== reference.libraryID ||
    String(attachment.key || "") !== reference.attachmentKey ||
    !Number.isInteger(Number(attachment.id))
  ) {
    throw new Error("The exact Zotero evidence attachment is unavailable.");
  }
  const attachmentID = Number(attachment.id);
  const options =
    Number.isInteger(reference.pageIndex) && Number(reference.pageIndex) >= 0
      ? { pageIndex: Number(reference.pageIndex) }
      : {};
  if (dependencies.openReader) {
    await dependencies.openReader(attachmentID, options);
    return;
  }
  if (dependencies.viewAttachment) {
    await dependencies.viewAttachment(attachmentID);
    return;
  }
  throw new Error("Zotero PDF navigation is unavailable.");
}
