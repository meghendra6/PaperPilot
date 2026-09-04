export function redactPath(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) {
    return "<redacted-local-path>";
  }
  return `…/${parts.slice(-2).join("/")}`;
}

const QUOTED_ABSOLUTE_PATH =
  /(["'])(\/(?!\/)[^"'\r\n]+|[A-Za-z]:[\\/][^"'\r\n]+)\1/g;
const UNQUOTED_ABSOLUTE_PATH =
  /(^|[\s(=])((?:\/(?!\/)|[A-Za-z]:[\\/])[^\s,;:)}\]>]+)/gm;

export function redactAbsolutePaths(text: string) {
  return String(text || "")
    .replace(
      QUOTED_ABSOLUTE_PATH,
      (_match, quote: string, path: string) =>
        `${quote}${redactPath(path)}${quote}`,
    )
    .replace(
      UNQUOTED_ABSOLUTE_PATH,
      (_match, prefix: string, path: string) => `${prefix}${redactPath(path)}`,
    );
}

const REDACTED_PERSISTENCE_KEYS = new Set([
  "rawEvent",
  "rawError",
  "extractionNotes",
]);

export function redactPersistenceFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPersistenceFields(entry)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (REDACTED_PERSISTENCE_KEYS.has(key)) {
      if (typeof child === "string") {
        result[key] = redactAbsolutePaths(child);
        continue;
      }
      if (Array.isArray(child)) {
        result[key] = child.map((entry) =>
          typeof entry === "string"
            ? redactAbsolutePaths(entry)
            : redactPersistenceFields(entry),
        );
        continue;
      }
    }
    result[key] = redactPersistenceFields(child);
  }
  return result as T;
}
