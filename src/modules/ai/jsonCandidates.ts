export function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function* extractBalancedJsonObjects(raw: string): Generator<string> {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        yield raw.slice(start, index + 1);
        start = -1;
      }
    }
  }
}

export function extractJsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const candidates = new Set<string>();
  const add = (candidate: string | undefined) => {
    const normalized = candidate?.trim();
    if (normalized) candidates.add(normalized);
  };

  add(trimmed);
  add(stripMarkdownFence(trimmed));
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    add(match[1]);
  }
  for (const candidate of extractBalancedJsonObjects(trimmed)) add(candidate);
  return [...candidates];
}

export function tryParseFirstJsonObject<T>(
  raw: string,
  validate: (parsed: unknown) => T | undefined,
): T | undefined {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const result = validate(parsed);
      if (result !== undefined) return result;
    } catch {
      // Continue to the next complete candidate.
    }
  }
  return undefined;
}

export function parseFirstJsonObject(raw: string): Record<string, unknown> {
  const parsed = tryParseFirstJsonObject(raw, (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined,
  );
  if (!parsed) throw new Error("No complete JSON object was found.");
  return parsed;
}
