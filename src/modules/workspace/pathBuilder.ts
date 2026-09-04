function sanitizeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

type WorkspaceZoteroGlobal = {
  getTempDirectory?: () => { path?: unknown } | undefined;
};

export function resolvePaperWorkspaceRoot(
  configuredRoot?: unknown,
  zotero: WorkspaceZoteroGlobal | undefined = (
    globalThis as typeof globalThis & { Zotero?: WorkspaceZoteroGlobal }
  ).Zotero,
) {
  const configured =
    typeof configuredRoot === "string" ? configuredRoot.trim() : "";
  if (configured) {
    return configured.replace(/[\\/]+$/g, "");
  }

  const tempPath = zotero?.getTempDirectory?.()?.path;
  if (typeof tempPath !== "string" || !tempPath.trim()) {
    throw new Error("Could not resolve a private Paper Pilot workspace root.");
  }
  return `${tempPath.trim().replace(/[\\/]+$/g, "")}/paperpilot-workspaces`;
}

export function buildPaperWorkspacePath(params: {
  root: string;
  itemID: number;
  title: string;
}) {
  const slug = sanitizeSegment(params.title) || `paper-${params.itemID}`;
  return `${params.root.replace(/\/+$/, "")}/${params.itemID}-${slug}`;
}
