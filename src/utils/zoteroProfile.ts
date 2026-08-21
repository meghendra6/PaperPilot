interface ZoteroProfileSurface {
  Profile?: {
    dir?: string;
  };
  getProfileDirectory?: () => { path?: string } | undefined;
}

export function getZoteroProfilePath(
  zotero = (globalThis as { Zotero?: ZoteroProfileSurface }).Zotero,
) {
  const modernPath = zotero?.Profile?.dir;
  if (typeof modernPath === "string" && modernPath) {
    return modernPath;
  }

  return zotero?.getProfileDirectory?.()?.path || "";
}
