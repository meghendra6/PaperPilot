import { assertResearchWorkspaceID } from "./contracts";
import { joinPath, researchProjectDirectory } from "./paths";

export function getResearchWorkspaceProjectExportDirectory(
  rootDir: string,
  projectID: string,
) {
  return joinPath(
    rootDir,
    "exports",
    "projects",
    assertResearchWorkspaceID(projectID, "projectID"),
  );
}

/**
 * Exact managed roots only. Callers must also verify filesystem ownership and
 * refuse symbolic links before removing any directory.
 */
export function getResearchWorkspaceProjectOwnedDirectories(
  rootDir: string,
  projectID: string,
) {
  const id = assertResearchWorkspaceID(projectID, "projectID");
  // Older AI/kernel jobs used runtime/<id>, alongside these shared roots.
  // Such an ID cannot safely identify a recursively removable legacy root.
  if (["builds", "context"].includes(id.toLowerCase())) {
    throw new Error(
      `Project ${id} conflicts with a shared runtime directory; cleanup requires explicit ownership.`,
    );
  }
  return [
    researchProjectDirectory(rootDir, id),
    joinPath(rootDir, "runtime", id),
    joinPath(rootDir, "runtime", "builds", id),
    joinPath(rootDir, "runtime", "context", id),
    joinPath(rootDir, "exports", "documents", id),
    getResearchWorkspaceProjectExportDirectory(rootDir, id),
  ];
}
