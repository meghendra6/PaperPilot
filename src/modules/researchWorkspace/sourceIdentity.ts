export interface ZoteroSourceIdentity {
  libraryID: number;
  itemKey: string;
  attachmentKey: string;
  standaloneAttachment: boolean;
}

function requireKey(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(
      label + " is required for Research Workspace source identity.",
    );
  }
  return normalized;
}

export function createZoteroSourceIdentity(params: {
  libraryID: unknown;
  itemKey: unknown;
  attachmentKey: unknown;
  standaloneAttachment?: boolean;
}): ZoteroSourceIdentity {
  const libraryID = Number(params.libraryID);
  if (!Number.isInteger(libraryID) || libraryID <= 0) {
    throw new Error(
      "A positive libraryID is required for Research Workspace source identity.",
    );
  }
  return {
    libraryID,
    itemKey: requireKey(params.itemKey, "itemKey"),
    attachmentKey: requireKey(params.attachmentKey, "attachmentKey"),
    standaloneAttachment: Boolean(params.standaloneAttachment),
  };
}

export function buildZoteroSourceID(identity: ZoteroSourceIdentity) {
  return [
    "zotero",
    String(identity.libraryID),
    encodeURIComponent(identity.itemKey),
    encodeURIComponent(identity.attachmentKey),
  ].join(":");
}

export function sameZoteroSource(
  left: ZoteroSourceIdentity,
  right: ZoteroSourceIdentity,
) {
  return (
    left.libraryID === right.libraryID &&
    left.itemKey === right.itemKey &&
    left.attachmentKey === right.attachmentKey
  );
}
