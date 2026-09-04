import { getZoteroProfilePath } from "../../utils/zoteroProfile";

function getProfilePath(profilePath?: string) {
  return profilePath || getZoteroProfilePath();
}

export function resolveCliUserHome(profilePath?: string) {
  const resolvedProfilePath = getProfilePath(profilePath);
  if (resolvedProfilePath.includes("/Library/")) {
    return resolvedProfilePath.split("/Library/")[0];
  }
  try {
    const runtime = globalThis as any;
    const home = runtime.Services?.dirsvc?.get(
      "Home",
      runtime.Ci?.nsIFile,
    )?.path;
    if (typeof home === "string" && home.trim()) return home.trim();
    const inherited = runtime.process?.env?.HOME;
    if (typeof inherited === "string" && inherited.trim()) {
      return inherited.trim();
    }
  } catch {
    // Fall through to an empty optional environment value.
  }
  return "";
}

export function buildCliCommandEnvironment(
  executablePath: string,
  profilePath?: string,
) {
  const userHome = resolveCliUserHome(profilePath);
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
