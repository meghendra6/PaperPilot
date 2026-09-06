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

let runSequence = 0;
export function createWorkspaceRunID() {
  return `${Date.now().toString(36)}-${(++runSequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function workspaceIdentityToken(value: string) {
  let first = 2166136261;
  let second = 5381;
  for (const char of value) {
    first = Math.imul(first ^ char.charCodeAt(0), 16777619);
    second = Math.imul(second, 33) ^ char.charCodeAt(0);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

/** The display title never determines a current run's identity or cleanup path. */
export function buildRunWorkspacePath(params: {
  root: string;
  itemID: number;
  sessionId: string;
  profile: "chat" | "analysis" | "discovery";
  runID: string;
}) {
  const identity =
    params.profile === "chat"
      ? `chat-${workspaceIdentityToken(params.sessionId)}`
      : `${params.profile}-${params.runID}`;
  if (
    !Number.isSafeInteger(params.itemID) ||
    params.itemID <= 0 ||
    !/^[a-z0-9-]+$/.test(identity)
  )
    throw new Error("Invalid workspace identity.");
  return `${params.root.replace(/[\\/]+$/g, "")}/${params.itemID}-${identity}`;
}
