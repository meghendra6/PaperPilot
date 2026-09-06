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
    if (separator > workspacePath.length) {
      await Zotero.File.createDirectoryIfMissingAsync(
        absolutePath.slice(0, separator),
      );
    }
    await Zotero.File.putContentsAsync(absolutePath, contents, "utf-8");
  }
}

const WORKSPACE_RUNTIME_FILE_PATHS = [
  "prompt.txt",
  "claude-prompt.txt",
  "gemini-prompt.txt",
  "output-schema.json",
  ...["codex", "claude", "gemini"].flatMap((engine) => [
    `${engine}-output.${engine === "codex" ? "jsonl" : "txt"}`,
    `${engine}-stderr.log`,
    `${engine}-exit.txt`,
    `${engine}-pid.txt`,
  ]),
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
      !WORKSPACE_RUNTIME_FILE_PATHS.includes(entry.path)
    )
      throw new Error(
        "Only generated runtime files may use runtime ownership.",
      );
    if (entry.path === "paperpilot-input-manifest.json")
      throw new Error("An input manifest cannot own itself.");
  }
  return manifest;
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
  let previous: WorkspaceInputManifest | undefined;
  if (io?.exists && (await io.exists(manifestPath))) {
    try {
      const text = await Zotero.File.getContentsAsync(manifestPath);
      previous = parseWorkspaceInputManifest(JSON.parse(String(text)));
    } catch {
      throw new Error(
        "The previous workspace input manifest is unreadable; its files were preserved.",
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
      throw new Error(
        "A workspace input was changed outside this run. Its files were preserved; move the edited file before retrying.",
      );
  }
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
