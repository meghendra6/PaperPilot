export function assertStudioID(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Invalid document or project identifier.");
  }
}

export function assertDocumentName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 240 ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    // eslint-disable-next-line no-control-regex -- Filenames must reject control bytes.
    /[\\\x00-\x1f\x7f:]/.test(value)
  ) {
    throw new Error(
      "Use a relative document name without empty or parent folders.",
    );
  }
}

/** Runtime snapshots must preserve every file on case-insensitive filesystems. */
export function assertRuntimeSnapshotPaths(names: readonly string[]): void {
  const paths = new Map<string, string>();
  for (const name of names) {
    assertDocumentName(name);
    const key = name.normalize("NFC").toLowerCase();
    const previous = paths.get(key);
    if (previous !== undefined)
      throw new Error(
        `Runtime file paths conflict: "${previous}" and "${name}". Rename one before running or building.`,
      );
    paths.set(key, name);
  }
  for (const [key, name] of paths) {
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index++) {
      const ancestor = paths.get(parts.slice(0, index).join("/"));
      if (ancestor !== undefined)
        throw new Error(
          `Runtime file paths conflict: "${ancestor}" is also a folder of "${name}". Rename one before running or building.`,
        );
    }
  }
}
