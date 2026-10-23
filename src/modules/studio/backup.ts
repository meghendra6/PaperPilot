import {
  assertStudioID,
  documentByteLength,
  parseStudioManifest,
  type StudioManifest,
} from "./contracts";

export const MAX_BACKUP_TEXT = 96 * 1024 * 1024;
export interface StudioDocumentBackup {
  format: "paperpilot-studio-documents";
  schemaVersion: 1;
  exportedAt: string;
  manifest: StudioManifest;
  blobs: Record<string, string>;
}

export function parseDocumentBackup(text: string): StudioDocumentBackup {
  if (typeof text !== "string" || text.length > MAX_BACKUP_TEXT)
    throw new Error("Document backups must be at most 96 MiB of JSON text.");
  const data = JSON.parse(text) as StudioDocumentBackup;
  if (
    data?.format !== "paperpilot-studio-documents" ||
    data.schemaVersion !== 1 ||
    !data.blobs ||
    typeof data.blobs !== "object" ||
    Array.isArray(data.blobs)
  )
    throw new Error("This is not a supported Paper Pilot document backup.");
  assertStudioID(data.manifest?.projectID);
  parseStudioManifest(data.manifest, data.manifest.projectID);
  const expected = new Set<string>();
  for (const doc of data.manifest.documents)
    for (const version of doc.versions) {
      expected.add(version.blobID);
      if (
        !Object.prototype.hasOwnProperty.call(data.blobs, version.blobID) ||
        documentByteLength(data.blobs[version.blobID]) !== version.bytes
      )
        throw new Error("The backup is missing or has damaged document bytes.");
    }
  if (Object.keys(data.blobs).some((id) => !expected.has(id)))
    throw new Error("The backup contains unreferenced blobs.");
  return data;
}
