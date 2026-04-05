export type CandidateSource =
  | "configured"
  | "path"
  | "nvm"
  | "homebrew"
  | "usr-local"
  | "volta"
  | "fallback";

export interface CodexExecutableProbe {
  path: string;
  source: CandidateSource;
  version?: string;
  loginStatus?: string;
  versionOk: boolean;
  loginOk: boolean;
}

function isAbsolutePath(path: string) {
  return path.startsWith("/");
}

export function parseCodexVersion(output?: string) {
  const match = output?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }
  return match.slice(1).map((part) => Number(part));
}

function compareCodexVersions(left?: string, right?: string) {
  const leftParts = parseCodexVersion(left);
  const rightParts = parseCodexVersion(right);

  if (!leftParts && !rightParts) {
    return 0;
  }
  if (!leftParts) {
    return -1;
  }
  if (!rightParts) {
    return 1;
  }

  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const leftPart = leftParts[i] ?? 0;
    const rightPart = rightParts[i] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

function sourceRank(source: CandidateSource) {
  switch (source) {
    case "configured":
      return 5;
    case "nvm":
      return 4;
    case "volta":
      return 3;
    case "path":
      return 2;
    case "homebrew":
    case "usr-local":
      return 1;
    case "fallback":
    default:
      return 0;
  }
}

export function chooseBestCodexExecutable(probes: CodexExecutableProbe[]) {
  return [...probes].sort((left, right) => {
    if (left.loginOk !== right.loginOk) {
      return left.loginOk ? -1 : 1;
    }

    if (left.versionOk !== right.versionOk) {
      return left.versionOk ? -1 : 1;
    }

    const versionComparison = compareCodexVersions(right.version, left.version);
    if (versionComparison !== 0) {
      return versionComparison;
    }

    const absoluteComparison =
      Number(isAbsolutePath(right.path)) - Number(isAbsolutePath(left.path));
    if (absoluteComparison !== 0) {
      return absoluteComparison;
    }

    return sourceRank(right.source) - sourceRank(left.source);
  })[0];
}
