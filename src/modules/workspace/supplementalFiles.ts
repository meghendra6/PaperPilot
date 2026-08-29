declare const Zotero: any;

export type WorkspaceSupplementalFiles = Readonly<Record<string, string>>;

const MAX_WORKSPACE_FILES = 512;
const MAX_WORKSPACE_FILE_CHARACTERS = 8_000_000;
const MAX_WORKSPACE_TOTAL_CHARACTERS = 24_000_000;

export function validateWorkspaceSupplementalFilePath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    throw new Error(`Unsafe supplemental workspace path: ${path || "(empty)"}`);
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || segment.length > 120,
    )
  ) {
    throw new Error(`Unsafe supplemental workspace path: ${path}`);
  }
  return path;
}

export async function writeWorkspaceSupplementalFiles(
  workspacePath: string,
  files: WorkspaceSupplementalFiles | undefined,
) {
  if (!files) return;
  const entries = Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length > MAX_WORKSPACE_FILES) {
    throw new Error(
      `Supplemental workspace contains too many files (${entries.length}).`,
    );
  }
  let totalCharacters = 0;
  for (const [relativePath, contents] of entries) {
    validateWorkspaceSupplementalFilePath(relativePath);
    if (typeof contents !== "string") {
      throw new Error(
        `Supplemental workspace file ${relativePath} is not text.`,
      );
    }
    if (contents.length > MAX_WORKSPACE_FILE_CHARACTERS) {
      throw new Error(
        `Supplemental workspace file ${relativePath} is too large.`,
      );
    }
    totalCharacters += contents.length;
    if (totalCharacters > MAX_WORKSPACE_TOTAL_CHARACTERS) {
      throw new Error("Supplemental workspace exceeds the total size limit.");
    }
  }
  for (const [relativePath, contents] of entries) {
    const absolutePath = `${workspacePath}/${relativePath}`;
    const separator = absolutePath.lastIndexOf("/");
    if (separator > workspacePath.length) {
      await Zotero.File.createDirectoryIfMissingAsync(
        absolutePath.slice(0, separator),
      );
    }
    await Zotero.File.putContentsAsync(absolutePath, contents, "utf-8");
  }
}
