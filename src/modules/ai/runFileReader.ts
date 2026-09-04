const loggedUnreadablePaths = new Set<string>();

export interface RunFileReaderDependencies {
  read?: (path: string) => Promise<unknown> | unknown;
  exists?: (path: string) => Promise<boolean> | boolean;
  log?: (error: unknown) => void;
}

export async function readOptionalRunTextFile(
  path: string,
  dependencies: RunFileReaderDependencies = {},
): Promise<string | undefined> {
  const runtime = globalThis as any;
  const read =
    dependencies.read ??
    ((target: string) => runtime.Zotero.File.getContentsAsync(target, "utf-8"));
  const exists =
    dependencies.exists ??
    ((target: string) => runtime.IOUtils.exists(target) as Promise<boolean>);
  try {
    return String((await read(path)) || "");
  } catch (error) {
    let isPresent: boolean | undefined;
    try {
      isPresent = await exists(path);
    } catch {
      isPresent = undefined;
    }
    if (isPresent === false) return "";
    if (!loggedUnreadablePaths.has(path)) {
      loggedUnreadablePaths.add(path);
      (dependencies.log ?? runtime.Zotero?.logError)?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return undefined;
  }
}
