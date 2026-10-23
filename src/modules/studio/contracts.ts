import { assertStudioID, assertDocumentName } from "./documentIdentity";
export { assertStudioID, assertDocumentName } from "./documentIdentity";
import { assertOutputOrigin, type OutputOrigin } from "./outputProvenance";

/** Original-format project documents. This schema is separate from artifacts. */
export interface StudioVersion {
  revision: number;
  blobID: string;
  bytes: number;
  savedAt: string;
  author: string;
  reason: "import" | "edit" | "restore" | "ai";
  sha256?: string;
  origin?: OutputOrigin;
  insertions?: StudioInsertion[];
}

export interface StudioInsertion {
  id: string;
  assetID: string;
  assetRevision: number;
  insertedAt: string;
}

export function assertInsertions(
  value: unknown,
): asserts value is StudioInsertion[] {
  if (!Array.isArray(value) || value.length > 2000)
    throw new Error("Invalid draft insertion history or limit exceeded.");
  const seen = new Set<string>();
  for (const entry of value) {
    assertStudioID(entry?.id);
    assertStudioID(entry.assetID);
    if (
      seen.has(entry.id) ||
      !Number.isSafeInteger(entry.assetRevision) ||
      entry.assetRevision < 1 ||
      !Number.isFinite(Date.parse(entry.insertedAt))
    )
      throw new Error("Invalid draft insertion receipt.");
    seen.add(entry.id);
  }
}

export interface StudioDocument {
  id: string;
  name: string;
  revision: number;
  versions: StudioVersion[];
  archived: boolean;
}

export interface StudioManifest {
  schemaVersion: 1;
  projectID: string;
  revision: number;
  documents: StudioDocument[];
  appliedChanges?: Record<string, { documentID: string; revision: number }>;
  importedContext?: { documentID: string; revision: number };
}

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export function documentByteLength(base64: unknown): number {
  if (
    typeof base64 !== "string" ||
    base64.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 ||
    base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(base64) ||
    (base64.includes("=") && !/^[^=]*={1,2}$/.test(base64))
  ) {
    throw new Error("Invalid document bytes or document exceeds 50 MiB.");
  }
  const bytes =
    (base64.length / 4) * 3 -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds 50 MiB.");
  return bytes;
}

function integer(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseStudioManifest(
  value: unknown,
  projectID: string,
): StudioManifest {
  const data = value as StudioManifest | undefined;
  if (
    !data ||
    data.schemaVersion !== 1 ||
    data.projectID !== projectID ||
    !integer(data.revision) ||
    !Array.isArray(data.documents) ||
    data.documents.length > 10000
  ) {
    throw new Error(
      "Unsupported or damaged document catalog. Existing files were preserved.",
    );
  }
  const ids = new Set<string>();
  if (data.appliedChanges !== undefined) {
    if (
      !data.appliedChanges ||
      typeof data.appliedChanges !== "object" ||
      Array.isArray(data.appliedChanges)
    )
      throw new Error("Invalid change receipts.");
    for (const [id, receipt] of Object.entries(data.appliedChanges)) {
      assertStudioID(id);
      assertStudioID(receipt?.documentID);
      if (!integer(receipt.revision))
        throw new Error("Invalid change receipt.");
    }
  }
  const names = new Set<string>();
  for (const doc of data.documents) {
    assertStudioID(doc?.id);
    assertDocumentName(doc.name);
    if (
      ids.has(doc.id) ||
      names.has(doc.name) ||
      !integer(doc.revision) ||
      typeof doc.archived !== "boolean" ||
      !Array.isArray(doc.versions) ||
      !doc.versions.length
    ) {
      throw new Error("Invalid document catalog entry.");
    }
    ids.add(doc.id);
    names.add(doc.name);
    let previous = 0;
    for (const version of doc.versions) {
      if (version.origin !== undefined) assertOutputOrigin(version.origin);
      if (version.insertions !== undefined)
        assertInsertions(version.insertions);
      assertStudioID(version?.blobID);
      if (
        !integer(version.revision) ||
        version.revision <= previous ||
        version.revision > doc.revision ||
        !Number.isSafeInteger(version.bytes) ||
        version.bytes < 0 ||
        version.bytes > MAX_DOCUMENT_BYTES ||
        (version.sha256 !== undefined &&
          !/^[a-f0-9]{64}$/.test(version.sha256)) ||
        typeof version.savedAt !== "string" ||
        !Number.isFinite(Date.parse(version.savedAt)) ||
        typeof version.author !== "string" ||
        version.author.length > 200 ||
        !["import", "edit", "restore", "ai"].includes(version.reason)
      ) {
        throw new Error("Invalid document version.");
      }
      previous = version.revision;
    }
  }
  if (data.importedContext !== undefined) {
    if (!data.importedContext || typeof data.importedContext !== "object")
      throw new Error("Invalid imported project context pointer.");
    assertStudioID(data.importedContext.documentID);
    const context = data.documents.find(
      (doc) => doc.id === data.importedContext!.documentID,
    );
    if (
      !context?.versions.some(
        (version) => version.revision === data.importedContext!.revision,
      )
    )
      throw new Error(
        "Imported project context is missing from the document history.",
      );
  }
  return data;
}

export class StudioRevisionConflict extends Error {
  constructor() {
    super(
      "This document changed after it was opened. Keep your edits and reload the saved version before applying them.",
    );
    this.name = "StudioRevisionConflict";
  }
}
