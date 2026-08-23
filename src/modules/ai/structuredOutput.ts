export type StructuredOutputSchema = Record<string, unknown>;

const capabilityCache = new Map<string, boolean>();

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function helpSupportsFlag(helpText: string, flag: string) {
  return String(helpText || "")
    .split(/\s+/)
    .some((token) => token === flag || token.startsWith(`${flag}=`));
}

export async function cliSupportsFlag(params: {
  executablePath: string;
  helpArgs: string[];
  flag: string;
  environment?: Record<string, string | undefined>;
}) {
  const cacheKey = [
    params.executablePath,
    params.helpArgs.join("\u0000"),
    params.flag,
    JSON.stringify(params.environment || {}),
  ].join("\u0001");
  const cached = capabilityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const internal = (globalThis as any).Zotero?.Utilities?.Internal as
      | { subprocess?: (path: string, args: string[]) => Promise<string> }
      | undefined;
    if (typeof internal?.subprocess !== "function") {
      capabilityCache.set(cacheKey, false);
      return false;
    }
    const environment = Object.entries(params.environment || {})
      .filter(
        (entry): entry is [string, string] =>
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]) &&
          typeof entry[1] === "string",
      )
      .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
    const command = [params.executablePath, ...params.helpArgs]
      .map(shellEscape)
      .join(" ");
    const helpText = await internal.subprocess("/bin/zsh", [
      "-lc",
      [...environment, `${command} 2>&1`].join(" && "),
    ]);
    const supported = helpSupportsFlag(helpText, params.flag);
    capabilityCache.set(cacheKey, supported);
    return supported;
  } catch {
    capabilityCache.set(cacheKey, false);
    return false;
  }
}
