function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Finds balanced JSON objects while respecting quoted strings and escapes.
 * The last successfully parsed object is returned because CLI agents often emit
 * progress prose before the final structured answer.
 */
function extractLastJsonObject(text: string): Record<string, unknown> {
  const candidates: Array<{ start: number; end: number; value: string }> = [];
  const starts: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      starts.push(index);
      continue;
    }
    if (character === "}" && starts.length > 0) {
      const start = starts.pop();
      if (start === undefined) continue;
      candidates.push({
        start,
        end: index,
        value: text.slice(start, index + 1),
      });
    }
  }
  candidates.sort(
    (left, right) => right.end - left.end || left.start - right.start,
  );
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the preceding balanced candidate.
    }
  }
  throw new Error("No valid JSON object was found in the agent response.");
}
function readObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${fieldName} must be an object.`);
  return value;
}
function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}
function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
function readArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array.`);
  return value;
}
function readBoolean(value: unknown, defaultValue = false): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}
function readNumber(
  value: unknown,
  fieldName: string,
  options: { defaultValue?: number; min?: number; max?: number } = {},
): number {
  const number =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : options.defaultValue;
  if (number === undefined)
    throw new Error(`${fieldName} must be a finite number.`);
  if (options.min !== undefined && number < options.min) {
    throw new Error(`${fieldName} must be >= ${options.min}.`);
  }
  if (options.max !== undefined && number > options.max) {
    throw new Error(`${fieldName} must be <= ${options.max}.`);
  }
  return number;
}

export {
  extractLastJsonObject,
  readObject,
  readString,
  readOptionalString,
  readArray,
  readBoolean,
  readNumber,
};
