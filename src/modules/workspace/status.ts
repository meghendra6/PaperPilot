export async function probeWorkspaceWritable(root: string) {
  const probeDir = root.replace(/\/+$/, "");
  const probePath = `${probeDir}/.writable-check.tmp`;

  try {
    await Zotero.File.createDirectoryIfMissingAsync(probeDir);
    await Zotero.File.putContentsAsync(probePath, "ok", "utf-8");
    await Zotero.File.removeIfExists(probePath);
    return true;
  } catch {
    return false;
  }
}
