import { getPref, setPref } from "../../utils/prefs";
import type {
  CandidateSource,
  CodexExecutableProbe,
} from "./executableSelection";
import { buildCodexCommandEnvironment } from "./environment";
import { chooseBestCodexExecutable } from "./executableSelection";

interface CodexExecutableCandidate {
  path: string;
  source: CandidateSource;
}

type InternalWithSubprocess = typeof Zotero.Utilities.Internal & {
  subprocess(command: string, args?: string[]): Promise<string>;
};

function getInternalWithSubprocess() {
  return Zotero.Utilities.Internal as InternalWithSubprocess;
}

function normalizeOutput(output: string) {
  return String(output || "")
    .trim()
    .replace(/\s+/g, " ");
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isAbsolutePath(path: string) {
  return path.startsWith("/");
}

async function pathExists(path: string) {
  try {
    return await IOUtils.exists(path);
  } catch {
    return false;
  }
}

function buildCodexProbeScript(path: string, args: string[]) {
  const environment = buildCodexCommandEnvironment(path);
  const exports = Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
  const command = [path, ...args].map(shellEscape).join(" ");
  return [...exports, command].join(" && ");
}

async function runCodexSubprocess(path: string, args: string[]) {
  try {
    const output = await getInternalWithSubprocess().subprocess("/bin/zsh", [
      "-lc",
      buildCodexProbeScript(path, args),
    ]);
    return {
      ok: true as const,
      output: normalizeOutput(output),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: String(error),
    };
  }
}

async function collectNvmCandidates(userHome: string) {
  const candidates: CodexExecutableCandidate[] = [];
  const nvmRoot = `${userHome}/.nvm/versions/node`;

  try {
    await Zotero.File.iterateDirectory(
      nvmRoot,
      async (entry: { isDir?: boolean; path: string }) => {
        if (!entry.isDir) {
          return;
        }

        const candidatePath = `${entry.path}/bin/codex`;
        if (await pathExists(candidatePath)) {
          candidates.push({ path: candidatePath, source: "nvm" });
        }
      },
    );
  } catch {
    // Ignore missing NVM directories.
  }

  return candidates;
}

async function collectCodexExecutableCandidates(configuredPath?: string) {
  const profilePath = Zotero.getProfileDirectory()?.path || "";
  const userHome = profilePath.includes("/Library/")
    ? profilePath.split("/Library/")[0]
    : "";
  const candidate = (
    configuredPath || String(getPref("codexExecutablePath") || "")
  ).trim();
  const candidates: CodexExecutableCandidate[] = [];

  if (candidate) {
    candidates.push({
      path: candidate,
      source: isAbsolutePath(candidate) ? "configured" : "path",
    });
  }

  if (userHome) {
    candidates.push(...(await collectNvmCandidates(userHome)));
    candidates.push({
      path: `${userHome}/.volta/bin/codex`,
      source: "volta",
    });
  }

  candidates.push(
    { path: "/opt/homebrew/bin/codex", source: "homebrew" },
    { path: "/usr/local/bin/codex", source: "usr-local" },
  );

  const unique: CodexExecutableCandidate[] = [];
  const seen = new Set<string>();

  for (const next of candidates) {
    const path = next.path.trim();
    if (!path || seen.has(path)) {
      continue;
    }

    if (isAbsolutePath(path) && !(await pathExists(path))) {
      continue;
    }

    seen.add(path);
    unique.push({ ...next, path });
  }

  if (!unique.length) {
    unique.push({ path: candidate || "codex", source: "fallback" });
  }

  return unique;
}

export async function probeCodexExecutable(
  path: string,
  source: CandidateSource = "configured",
): Promise<CodexExecutableProbe> {
  const versionResult = await runCodexSubprocess(path, ["--version"]);
  const loginResult = versionResult.ok
    ? await runCodexSubprocess(path, ["login", "status"])
    : {
        ok: false as const,
        error: "Skipped login probe because version probe failed.",
      };

  return {
    path,
    source,
    version: versionResult.ok ? versionResult.output : undefined,
    loginStatus: loginResult.ok ? loginResult.output : loginResult.error,
    versionOk: versionResult.ok,
    loginOk: loginResult.ok,
  };
}

export async function resolveCodexExecutablePath(configuredPath?: string) {
  const configured = (
    configuredPath || String(getPref("codexExecutablePath") || "")
  ).trim();
  const candidates = await collectCodexExecutableCandidates(configured);
  const probes: CodexExecutableProbe[] = [];

  for (const candidate of candidates) {
    probes.push(await probeCodexExecutable(candidate.path, candidate.source));
  }

  addon.data.codexExecutableCandidates = probes;
  const best = chooseBestCodexExecutable(probes);
  const resolvedPath = best?.path || configured || "codex";

  addon.data.codexExecutableResolvedPath = resolvedPath;
  if (resolvedPath && resolvedPath !== configured) {
    setPref("codexExecutablePath", resolvedPath);
  }

  return resolvedPath;
}
