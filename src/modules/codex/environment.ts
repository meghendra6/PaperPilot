function getProfilePath(profilePath?: string) {
  if (profilePath) {
    return profilePath;
  }

  return (
    (
      globalThis as {
        Zotero?: { getProfileDirectory?: () => { path?: string } | undefined };
      }
    ).Zotero?.getProfileDirectory?.()?.path || ""
  );
}

export function resolveCodexUserHome(profilePath?: string) {
  const resolvedProfilePath = getProfilePath(profilePath);
  return resolvedProfilePath.includes("/Library/")
    ? resolvedProfilePath.split("/Library/")[0]
    : "";
}

export function buildCodexCommandEnvironment(
  executablePath: string,
  profilePath?: string,
) {
  const userHome = resolveCodexUserHome(profilePath);
  const executableDir = executablePath.includes("/")
    ? executablePath.replace(/\/[^/]+$/, "")
    : "";
  const pathParts = [
    executableDir,
    `${userHome}/.local/bin`,
    `${userHome}/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter(Boolean);

  return {
    HOME: userHome || undefined,
    XDG_CONFIG_HOME: userHome ? `${userHome}/.config` : undefined,
    PATH: Array.from(new Set(pathParts)).join(":"),
  };
}
