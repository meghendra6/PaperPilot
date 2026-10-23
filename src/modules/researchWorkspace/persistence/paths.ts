import { assertResearchWorkspaceID } from "./contracts";

export function joinPath(...parts: string[]) {
  const separator = parts.some((part) => part.includes("\\")) ? "\\" : "/";
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/g, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .filter(Boolean)
    .join(separator);
}

export function researchProjectDirectory(root: string, projectID: string) {
  return joinPath(
    root,
    "projects",
    `project-${assertResearchWorkspaceID(projectID, "projectID")}`,
  );
}
