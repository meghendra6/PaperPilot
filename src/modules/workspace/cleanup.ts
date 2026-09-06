import { getPref } from "../../utils/prefs";
import { resolveSessionHistoryPrefs } from "../session/historyPrefs";
import {
  parseWorkspaceInputManifest,
  workspaceInputContentFingerprint,
} from "./supplementalFiles";

function isSafeWorkspacePath(workspacePath: string) {
  const normalized = workspacePath.trim().replace(/[\\/]+$/g, "");
  const segments = normalized.split(/[\\/]/);
  const segment = segments.at(-1) || "";
  return Boolean(
    normalized &&
      !segments.includes("..") &&
      !segments.includes(".") &&
      /^\d+-[a-z0-9][a-z0-9-]*$/.test(segment),
  );
}

/** Remove only manifest-owned files at the exact allocated path. */
export async function cleanupWorkspaceDirectory(workspacePath: string) {
  if (!isSafeWorkspacePath(workspacePath)) return false;
  const io = (globalThis as any).IOUtils;
  const zotero = (globalThis as any).Zotero;
  if (!io?.remove || !io?.exists || !zotero?.File?.getContentsAsync)
    return false;
  const manifestPath = `${workspacePath}/paperpilot-input-manifest.json`;
  if (!(await io.exists(manifestPath))) return false;
  let manifest;
  try {
    manifest = parseWorkspaceInputManifest(
      JSON.parse(String(await zotero.File.getContentsAsync(manifestPath))),
    );
  } catch {
    return false; // Unknown/legacy/corrupt workspaces do not establish ownership.
  }
  const directories = new Set<string>();
  let preservedEdits = false;
  const removable = [];
  for (const entry of manifest.files) {
    if (!(await io.exists(`${workspacePath}/${entry.path}`))) continue;
    if (entry.contentFingerprint !== "runtime-owned") {
      const current = String(
        await zotero.File.getContentsAsync(`${workspacePath}/${entry.path}`),
      );
      if (
        workspaceInputContentFingerprint(current) !== entry.contentFingerprint
      ) {
        preservedEdits = true;
        continue;
      }
    }
    removable.push(entry);
  }
  for (const entry of removable) {
    const parts = entry.path.split("/");
    for (let depth = 1; depth < parts.length; depth++)
      directories.add(`${workspacePath}/${parts.slice(0, depth).join("/")}`);
    await io.remove(`${workspacePath}/${entry.path}`, {
      recursive: false,
      ignoreAbsent: true,
    });
  }
  if (!preservedEdits)
    await io.remove(manifestPath, { recursive: false, ignoreAbsent: true });
  // Non-recursive removal is safe even when the user added files in a directory.
  // The legacy empty Codex figures folder is removable only if still empty.
  directories.add(`${workspacePath}/figures`);
  for (const directory of [...directories].sort(
    (left, right) => right.length - left.length,
  )) {
    try {
      await io.remove(directory, { recursive: false, ignoreAbsent: true });
    } catch {
      /* Keep nonempty directories and all unowned contents. */
    }
  }
  try {
    await io.remove(workspacePath, { recursive: false, ignoreAbsent: true });
  } catch {
    /* User files may remain; none of their ancestors are removed recursively. */
  }
  return true;
}

export async function cleanupWorkspaceIfEnabled(workspacePath: string) {
  if (
    !getPref("codexAutoCleanWorkspace") &&
    resolveSessionHistoryPrefs().persistHistory
  )
    return false;
  try {
    return await cleanupWorkspaceDirectory(workspacePath);
  } catch {
    return false;
  }
}
