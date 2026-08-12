import type { CriticalReadAgentOutput } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function list(value: unknown, max: number) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, max)
    : [];
}

function methodChecks(value: unknown) {
  if (!Array.isArray(value)) return [];
  const statuses = new Set([
    "supported",
    "concern",
    "unclear",
    "not_applicable",
  ]);
  return value
    .flatMap((entry) => {
      if (!record(entry)) return [];
      const area = text(entry.area);
      const finding = text(entry.finding);
      const status = text(entry.status);
      if (!area || !finding || !statuses.has(status)) return [];
      return [
        {
          area,
          status: status as
            | "supported"
            | "concern"
            | "unclear"
            | "not_applicable",
          finding,
          sourceLocator: text(entry.sourceLocator) || undefined,
        },
      ];
    })
    .slice(0, 12);
}

function provenance(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!record(entry)) return [];
      const source = text(entry.source);
      const claim = text(entry.text);
      if (
        !claim ||
        (source !== "paper_claim" && source !== "agent_inference")
      ) {
        return [];
      }
      return [
        {
          source: source as "paper_claim" | "agent_inference",
          text: claim,
          sourceLocator: text(entry.sourceLocator) || undefined,
        },
      ];
    })
    .slice(0, 12);
}

function extract(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced || raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start
    ? candidate.slice(start, end + 1)
    : candidate;
}

export function parseCriticalReadOutput(raw: string): CriticalReadAgentOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extract(raw));
  } catch (error) {
    throw new Error(
      `Invalid Critical Read JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!record(parsed) || !text(parsed.summary)) {
    throw new Error("Critical Read JSON must include a non-empty summary.");
  }
  const checks = methodChecks(parsed.methodChecks);
  const sourcedClaims = provenance(parsed.provenance);
  return {
    summary: text(parsed.summary),
    items: list(parsed.items, 12),
    sourceLocators: list(parsed.sourceLocators, 12),
    limitations: list(parsed.limitations, 8),
    ...(checks.length ? { methodChecks: checks } : {}),
    ...(sourcedClaims.length ? { provenance: sourcedClaims } : {}),
  };
}
