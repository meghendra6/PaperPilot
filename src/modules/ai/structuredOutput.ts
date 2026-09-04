export type StructuredOutputSchema = Record<string, unknown>;

const capabilityCache = new Map<string, boolean>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaCompatibilityIssue(
  schema: Record<string, unknown>,
  path: string,
): string | undefined {
  if (
    schema.type === undefined &&
    schema.$ref === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined &&
    schema.allOf === undefined
  ) {
    return `${path}.type is required`;
  }

  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      return `${path}.additionalProperties must be false`;
    }
    if (!isRecord(schema.properties)) {
      return `${path}.properties must be an object`;
    }
    if (
      !Array.isArray(schema.required) ||
      schema.required.some((value) => typeof value !== "string")
    ) {
      return `${path}.required must list every property`;
    }
    const propertyNames = Object.keys(schema.properties);
    const requiredNames = new Set(schema.required as string[]);
    if (
      requiredNames.size !== propertyNames.length ||
      propertyNames.some((name) => !requiredNames.has(name))
    ) {
      return `${path}.required must list every property exactly once`;
    }
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      if (!isRecord(propertySchema)) {
        return `${path}.properties.${name} must be a schema object`;
      }
      const issue = schemaCompatibilityIssue(
        propertySchema,
        `${path}.properties.${name}`,
      );
      if (issue) return issue;
    }
  }

  if (schema.type === "array") {
    if (!isRecord(schema.items)) {
      return `${path}.items must be a schema object`;
    }
    const issue = schemaCompatibilityIssue(schema.items, `${path}.items`);
    if (issue) return issue;
  }

  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = schema[keyword];
    if (branches === undefined) continue;
    if (
      !Array.isArray(branches) ||
      branches.some((value) => !isRecord(value))
    ) {
      return `${path}.${keyword} must contain schema objects`;
    }
    for (const [index, branch] of branches.entries()) {
      const issue = schemaCompatibilityIssue(
        branch as Record<string, unknown>,
        `${path}.${keyword}[${index}]`,
      );
      if (issue) return issue;
    }
  }

  for (const keyword of ["$defs", "definitions"] as const) {
    const definitions = schema[keyword];
    if (definitions === undefined) continue;
    if (!isRecord(definitions)) {
      return `${path}.${keyword} must be an object`;
    }
    for (const [name, definition] of Object.entries(definitions)) {
      if (!isRecord(definition)) {
        return `${path}.${keyword}.${name} must be a schema object`;
      }
      const issue = schemaCompatibilityIssue(
        definition,
        `${path}.${keyword}.${name}`,
      );
      if (issue) return issue;
    }
  }

  return undefined;
}

export function nativeStructuredOutputSchemaIssue(
  schema: StructuredOutputSchema,
) {
  if (schema.type !== "object") {
    return "root.type must be object";
  }
  return schemaCompatibilityIssue(schema, "root");
}

export function compatibleNativeOutputSchema(schema?: StructuredOutputSchema) {
  return schema && !nativeStructuredOutputSchemaIssue(schema)
    ? schema
    : undefined;
}

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
      (globalThis as any).ztoolkit?.log?.(
        `Native structured output probe unavailable for ${params.executablePath}; using parser validation.`,
      );
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
    if (supported) capabilityCache.set(cacheKey, true);
    return supported;
  } catch (error) {
    (globalThis as any).ztoolkit?.log?.(
      `Native structured output probe failed for ${params.executablePath}; using parser validation.`,
      error,
    );
    return false;
  }
}
