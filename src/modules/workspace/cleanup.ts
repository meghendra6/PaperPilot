import { getPref } from "../../utils/prefs";
import {
  buildPaperWorkspacePath,
  resolvePaperWorkspaceRoot,
} from "./pathBuilder";
import { getRunWorkspaceTitle, type RunProfile } from "../ai/runProfile";
import { resolveSessionHistoryPrefs } from "../session/historyPrefs";

function isSafeWorkspacePath(workspacePath: string) {
  const normalized = workspacePath.trim().replace(/[\\/]+$/g, "");
  const segment = normalized.split(/[\\/]/).pop() || "";
  return Boolean(
    normalized &&
      normalized !== "/" &&
      normalized !== "." &&
      /^\d+-[a-z0-9][a-z0-9-]*$/.test(segment),
  );
}

export async function cleanupWorkspaceDirectory(workspacePath: string) {
  if (!isSafeWorkspacePath(workspacePath)) {
    return false;
  }

  const ioUtils = (
    globalThis as typeof globalThis & { IOUtils?: typeof IOUtils }
  ).IOUtils;
  if (ioUtils?.remove) {
    await ioUtils.remove(workspacePath, {
      recursive: true,
      ignoreAbsent: true,
    });
    return true;
  }

  const zotero = (globalThis as typeof globalThis & { Zotero?: typeof Zotero })
    .Zotero;
  if (zotero?.File?.removeIfExists) {
    await zotero.File.removeIfExists(workspacePath);
    return true;
  }

  return false;
}

export async function cleanupWorkspaceIfEnabled(workspacePath: string) {
  if (
    !getPref("codexAutoCleanWorkspace") &&
    resolveSessionHistoryPrefs().persistHistory
  ) {
    return false;
  }

  try {
    return await cleanupWorkspaceDirectory(workspacePath);
  } catch {
    return false;
  }
}

export async function cleanupPaperWorkspaceForItemIfEnabled(params: {
  itemID: number;
  title: string;
  profile?: RunProfile;
}) {
  const workspaceRoot = resolvePaperWorkspaceRoot(
    getPref("codexWorkspaceRoot"),
  );
  return cleanupWorkspaceIfEnabled(
    buildPaperWorkspacePath({
      root: workspaceRoot,
      itemID: params.itemID,
      title: getRunWorkspaceTitle(params.title, params.profile || "chat"),
    }),
  );
}
