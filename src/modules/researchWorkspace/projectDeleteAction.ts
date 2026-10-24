import { deleteResearchWorkspaceProject } from "./facade";
import { button, releaseOperations, setMessage } from "./projectSurfaceShared";

interface ProjectToDelete {
  projectID: string;
  name: string;
}

/** Success is announced only after project cleanup and home refresh finish. */
export async function deleteProjectFromSurface(
  root: HTMLElement,
  project: ProjectToDelete,
  renderHome: () => Promise<void>,
) {
  const confirmed =
    root.ownerDocument.defaultView?.confirm(
      `Permanently delete “${project.name}”? This removes its documents, imported PDF copies, saved versions, conversations, research artifacts, project-owned temporary files, and project-managed exports and backups. This cannot be undone. Original Zotero items and attachments, and files saved separately, will be preserved.`,
    ) ?? false;
  if (!confirmed) return;
  if (!releaseOperations(root, "Deleting this project")) return;
  setMessage(root, `Deleting “${project.name}”…`);
  await deleteResearchWorkspaceProject(project.projectID);
  await renderHome();
  setMessage(root, `Deleted “${project.name}”.`, "success");
}

export function projectDeleteButton(
  root: HTMLElement,
  project: ProjectToDelete,
  renderHome: () => Promise<void>,
) {
  const node = button(root.ownerDocument, "Delete project…", () =>
    deleteProjectFromSurface(root, project, renderHome),
  );
  node.setAttribute("aria-label", `Delete project ${project.name}`);
  return node;
}
