import { WorkspacePreparationError } from "./preparationError";

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

export type WorkspaceSymlinkProbe = (
  path: string,
) => boolean | Promise<boolean>;

/** True when the entry itself is a symbolic link; the link is not followed. */
export function isWorkspaceSymlink(path: string): boolean {
  try {
    return Boolean(Zotero.File.pathToFile(path).isSymlink());
  } catch {
    return false; // A missing entry is not a link.
  }
}

/**
 * Finds a symbolic link on the way to a workspace entry. The agent can create
 * links inside its writable workspace, and Paper Pilot writes and removes with
 * full user rights, so going through a planted link would reach files outside
 * the sandbox. Atomic writes also use a fixed `<path>.tmp` sibling.
 *
 * Paper Pilot creates the allocated workspace directory itself, so a link in
 * its place was planted too and is reported as ".". The configured workspace
 * root above it may legitimately be a link and is not checked.
 */
export async function findWorkspaceSymlink(
  workspacePath: string,
  relativePath: string,
  isSymlink: WorkspaceSymlinkProbe = isWorkspaceSymlink,
): Promise<string | undefined> {
  if (await isSymlink(workspacePath.replace(/[\\/]+$/, ""))) return ".";
  const segments = relativePath.split("/");
  for (let depth = 1; depth <= segments.length; depth++) {
    const candidate = segments.slice(0, depth).join("/");
    if (await isSymlink(`${workspacePath}/${candidate}`)) return candidate;
  }
  const tmpSibling = `${relativePath}.tmp`;
  if (await isSymlink(`${workspacePath}/${tmpSibling}`)) return tmpSibling;
  return undefined;
}

export async function assertNoWorkspaceSymlink(
  workspacePath: string,
  relativePath: string,
  isSymlink?: WorkspaceSymlinkProbe,
) {
  const link = await findWorkspaceSymlink(
    workspacePath,
    relativePath,
    isSymlink,
  );
  if (link)
    throw new WorkspacePreparationError(
      `Workspace entry "${link}" is a symbolic link, so Paper Pilot will not write through it. Remove the link from "${workspacePath}" or start a new conversation.`,
    );
}

/** Writes one workspace text file after refusing symbolic links on its path. */
export async function writeWorkspaceTextFile(
  workspacePath: string,
  relativePath: string,
  contents: string,
) {
  await assertNoWorkspaceSymlink(workspacePath, relativePath);
  await Zotero.File.putContentsAsync(
    `${workspacePath}/${relativePath}`,
    contents,
    "utf-8",
  );
}

function validatedWorkspaceEntries(files: WorkspaceSupplementalFiles) {
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
    if (relativePath === "paperpilot-input-manifest.json") {
      throw new Error("The workspace input manifest path is reserved.");
    }
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
  return entries;
}

export async function writeWorkspaceSupplementalFiles(
  workspacePath: string,
  files: WorkspaceSupplementalFiles | undefined,
) {
  if (!files) return;
  for (const [relativePath, contents] of validatedWorkspaceEntries(files)) {
    const absolutePath = `${workspacePath}/${relativePath}`;
    const separator = absolutePath.lastIndexOf("/");
    await assertNoWorkspaceSymlink(workspacePath, relativePath);
    if (separator > workspacePath.length) {
      await Zotero.File.createDirectoryIfMissingAsync(
        absolutePath.slice(0, separator),
      );
    }
    await Zotero.File.putContentsAsync(absolutePath, contents, "utf-8");
  }
}

/** The selected-area image that a figure explanation run copies in. */
export const WORKSPACE_IMAGE_INPUT_PATH = "figures/selected-region.png";
const MAX_WORKSPACE_IMAGE_BYTES = 20 * 1024 * 1024;

const WORKSPACE_RUNTIME_FILE_PATHS = [
  "prompt.txt",
  "claude-prompt.txt",
  "output-schema.json",
  WORKSPACE_IMAGE_INPUT_PATH,
  ...["codex", "claude"].flatMap((engine) => [
    `${engine}-output.${engine === "codex" ? "jsonl" : "txt"}`,
    `${engine}-stderr.log`,
    `${engine}-exit.txt`,
    `${engine}-pid.txt`,
  ]),
];
// Manifests written before Gemini CLI support was removed still list these as
// runtime-owned. Accept them when reading (so reused chat workspaces keep
// working and get cleaned up) but never write them into new manifests.
const LEGACY_WORKSPACE_RUNTIME_FILE_PATHS = [
  "gemini-prompt.txt",
  "gemini-output.txt",
  "gemini-stderr.log",
  "gemini-exit.txt",
  "gemini-pid.txt",
];

export interface WorkspaceInputManifest {
  version: 1;
  runID: string;
  scopeFingerprint: string;
  sourceIDs: readonly string[];
  artifactIDs: readonly string[];
  files: Array<{ path: string; contentFingerprint: string }>;
}

export function parseWorkspaceInputManifest(
  value: unknown,
): WorkspaceInputManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid input manifest");
  const manifest = value as WorkspaceInputManifest;
  if (
    manifest.version !== 1 ||
    typeof manifest.runID !== "string" ||
    !manifest.runID ||
    typeof manifest.scopeFingerprint !== "string" ||
    !Array.isArray(manifest.sourceIDs) ||
    !manifest.sourceIDs.every((id) => typeof id === "string") ||
    !Array.isArray(manifest.artifactIDs) ||
    !manifest.artifactIDs.every((id) => typeof id === "string") ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > MAX_WORKSPACE_FILES + 20
  )
    throw new Error("Invalid input manifest");
  const paths = new Set<string>();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.contentFingerprint !== "string"
    )
      throw new Error("Invalid input manifest file entry");
    validateWorkspaceSupplementalFilePath(entry.path);
    if (paths.has(entry.path))
      throw new Error("Duplicate input manifest path.");
    paths.add(entry.path);
    if (
      entry.contentFingerprint === "runtime-owned" &&
      !WORKSPACE_RUNTIME_FILE_PATHS.includes(entry.path) &&
      !LEGACY_WORKSPACE_RUNTIME_FILE_PATHS.includes(entry.path)
    )
      throw new Error(
        "Only generated runtime files may use runtime ownership.",
      );
    if (entry.path === "paperpilot-input-manifest.json")
      throw new Error("An input manifest cannot own itself.");
  }
  return manifest;
}

/**
 * Copies one PNG into the runtime-owned image path after the manifest exists,
 * so workspace cleanup removes it with the other generated files.
 */
export async function stageWorkspaceImageInput(
  workspacePath: string,
  sourcePath: string,
): Promise<string> {
  if (!/\.png$/i.test(sourcePath))
    throw new Error("Only a PNG image can be attached to a workspace run.");
  const io = (globalThis as typeof globalThis & { IOUtils?: any }).IOUtils;
  if (!io?.stat || !io?.copy)
    throw new Error("Cannot copy the selected image into the workspace.");
  const info = await io.stat(sourcePath);
  if (info?.type !== "regular" || Number(info.size) > MAX_WORKSPACE_IMAGE_BYTES)
    throw new Error("The selected image is missing or too large to attach.");
  const destination = `${workspacePath}/${WORKSPACE_IMAGE_INPUT_PATH}`;
  await assertNoWorkspaceSymlink(workspacePath, WORKSPACE_IMAGE_INPUT_PATH);
  await Zotero.File.createDirectoryIfMissingAsync(
    destination.slice(0, destination.lastIndexOf("/")),
  );
  await io.copy(sourcePath, destination);
  return destination;
}

export function workspaceInputContentFingerprint(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16)}-${text.length}`;
}

/** Replace only previous manifest-owned inputs; never remove unknown user files. */
export async function writeOwnedWorkspaceInputs(params: {
  workspacePath: string;
  files: WorkspaceSupplementalFiles;
  runID: string;
  scopeFingerprint: string;
  sourceIDs: readonly string[];
  artifactIDs?: readonly string[];
}) {
  // Reject invalid replacements before touching any previously owned input.
  validatedWorkspaceEntries(params.files);
  const manifestPath = `${params.workspacePath}/paperpilot-input-manifest.json`;
  const io = (globalThis as typeof globalThis & { IOUtils?: any }).IOUtils;
  if (!io?.exists) {
    throw new Error("Cannot safely check existing workspace inputs.");
  }
  let previous: WorkspaceInputManifest | undefined;
  if (await io.exists(manifestPath)) {
    try {
      const text = await Zotero.File.getContentsAsync(manifestPath);
      previous = parseWorkspaceInputManifest(JSON.parse(String(text)));
    } catch {
      throw new WorkspacePreparationError(
        "The previous workspace input manifest is unreadable; its files were preserved. Start a new conversation to continue.",
      );
    }
  }
  // A new manifest may only adopt paths that do not already contain unowned data.
  const ownedPaths = new Set(previous?.files.map((entry) => entry.path));
  for (const path of new Set([
    ...Object.keys(params.files),
    ...WORKSPACE_RUNTIME_FILE_PATHS,
  ])) {
    if (
      !ownedPaths.has(path) &&
      (await io.exists(`${params.workspacePath}/${path}`))
    ) {
      throw new WorkspacePreparationError(
        `Workspace file "${path}" is not owned by Paper Pilot. Its files were preserved; move the conflicting file from "${params.workspacePath}" before retrying, or start a new conversation.`,
      );
    }
  }
  // Refuse edited inputs before deleting anything or launching a new run.
  for (const entry of previous?.files ?? []) {
    if (
      entry.contentFingerprint === "runtime-owned" ||
      !(await io.exists(`${params.workspacePath}/${entry.path}`))
    )
      continue;
    const current = String(
      await Zotero.File.getContentsAsync(
        `${params.workspacePath}/${entry.path}`,
      ),
    );
    if (workspaceInputContentFingerprint(current) !== entry.contentFingerprint)
      throw new WorkspacePreparationError(
        `Workspace input "${entry.path}" was changed outside this run. Its files were preserved; move the edited file from "${params.workspacePath}" before retrying, or start a new conversation.`,
      );
  }
  // Check every path this run removes or writes before changing anything.
  for (const path of new Set([
    "paperpilot-input-manifest.json",
    ...(previous?.files.map((entry) => entry.path) ?? []),
    ...Object.keys(params.files),
  ]))
    await assertNoWorkspaceSymlink(params.workspacePath, path);
  for (const entry of previous?.files ?? []) {
    validateWorkspaceSupplementalFilePath(entry.path);
    if (!io?.remove)
      throw new Error("Cannot safely replace the previous workspace inputs.");
    await io.remove(`${params.workspacePath}/${entry.path}`, {
      recursive: false,
      ignoreAbsent: true,
    });
  }
  const manifest: WorkspaceInputManifest = {
    version: 1,
    runID: params.runID,
    scopeFingerprint: params.scopeFingerprint,
    sourceIDs: params.sourceIDs,
    artifactIDs: params.artifactIDs ?? [],
    files: [
      ...Object.entries(params.files).map(([path, text]) => ({
        path: validateWorkspaceSupplementalFilePath(path),
        contentFingerprint: workspaceInputContentFingerprint(text),
      })),
      ...WORKSPACE_RUNTIME_FILE_PATHS.filter(
        (path) => !(path in params.files),
      ).map((path) => ({ path, contentFingerprint: "runtime-owned" })),
    ],
  };
  // Register all planned files first so interruption during writes remains recoverable.
  await Zotero.File.putContentsAsync(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  await writeWorkspaceSupplementalFiles(params.workspacePath, params.files);
  return manifest;
}
