export interface RemovalSafetyPorts {
  inspect(path: string): Promise<"missing" | "file" | "directory" | "symlink">;
  children(path: string): Promise<string[]>;
}

/** Preflight every target before the first removal; never traverse a link. */
export async function assertSafeProjectRemoval(
  path: string,
  rootDir: string,
  ports: RemovalSafetyPorts,
) {
  const normalized = path.replace(/\\/g, "/");
  const root = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized.startsWith(`${root}/`))
    throw new Error("Project cleanup target is outside its storage root.");
  const segments = normalized.slice(root.length + 1).split("/");
  if (segments.some((part) => !part || part === "." || part === ".."))
    throw new Error("Invalid project cleanup path.");
  const separator = path.includes("\\") ? "\\" : "/";
  const native = (value: string) => value.split("/").join(separator);
  let ancestor = root;
  for (const part of ["", ...segments]) {
    if (part) ancestor += `/${part}`;
    const kind = await ports.inspect(native(ancestor));
    if (kind === "symlink")
      throw new Error(
        `Project cleanup refused a symbolic link: ${native(ancestor)}`,
      );
    if (kind === "missing") return;
    if (kind !== "directory" && ancestor !== normalized)
      throw new Error("Project cleanup ancestor is not a directory.");
  }
  const walk = async (entry: string): Promise<void> => {
    const kind = await ports.inspect(entry);
    if (kind === "symlink")
      throw new Error(`Project cleanup refused a symbolic link: ${entry}`);
    if (kind !== "directory") return;
    const parent = entry.replace(/\\/g, "/").replace(/\/+$/, "");
    for (const child of await ports.children(entry)) {
      const name = child.replace(/\\/g, "/");
      const tail = name.slice(parent.length + 1);
      if (
        !name.startsWith(`${parent}/`) ||
        !tail ||
        tail.includes("/") ||
        tail === "." ||
        tail === ".."
      )
        throw new Error("Invalid child returned during project cleanup.");
      await walk(child);
    }
  };
  await walk(path);
}
