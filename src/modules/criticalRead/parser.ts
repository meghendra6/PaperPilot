import type { CriticalReadAgentOutput, CriticalReadStepID } from "./types";

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

function alternatives(value: unknown) {
  if (!Array.isArray(value)) return [];
  const addressedValues = new Set(["yes", "partly", "no", "unclear"]);
  return value
    .flatMap((entry) => {
      if (!record(entry)) return [];
      const explanation = text(entry.explanation);
      const explainedResult = text(entry.explainedResult);
      const challengedAssumption = text(entry.challengedAssumption);
      const discriminatingExperiment = text(entry.discriminatingExperiment);
      const addressedByPaper = text(entry.addressedByPaper);
      if (
        !explanation ||
        !explainedResult ||
        !challengedAssumption ||
        !discriminatingExperiment ||
        !addressedValues.has(addressedByPaper)
      ) {
        return [];
      }
      return [
        {
          explanation,
          explainedResult,
          challengedAssumption,
          discriminatingExperiment,
          addressedByPaper: addressedByPaper as
            | "yes"
            | "partly"
            | "no"
            | "unclear",
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

export function parseCriticalReadOutput(
  raw: string,
  stepID?: Exclude<CriticalReadStepID, 3>,
): CriticalReadAgentOutput {
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
  const parsedAlternatives = alternatives(parsed.alternatives);
  if (stepID === 4) {
    const normalizedAreas = new Set(
      checks.map((entry) => entry.area.toLowerCase().replace(/[^a-z]+/g, " ")),
    );
    const essentialAreas = [
      /data|sampling|split/,
      /baseline|comparison/,
      /metric/,
      /validity|assumption|threat/,
      /reproduc|resource/,
    ];
    if (
      checks.length < 7 ||
      essentialAreas.some(
        (pattern) => ![...normalizedAreas].some((area) => pattern.test(area)),
      )
    ) {
      throw new Error(
        "Critical Read Step 4 must classify the full methodology checklist, including data, baselines, metrics, validity, and reproducibility.",
      );
    }
  }
  if (
    stepID === 6 &&
    (!sourcedClaims.some((entry) => entry.source === "paper_claim") ||
      !sourcedClaims.some((entry) => entry.source === "agent_inference"))
  ) {
    throw new Error(
      "Critical Read Step 6 must separate paper claims from agent inference.",
    );
  }
  if (stepID === 7 && !parsedAlternatives.length) {
    throw new Error(
      "Critical Read Step 7 must include an alternative and a discriminating experiment.",
    );
  }
  return {
    summary: text(parsed.summary),
    items: list(parsed.items, 12),
    sourceLocators: list(parsed.sourceLocators, 12),
    limitations: list(parsed.limitations, 8),
    ...(checks.length ? { methodChecks: checks } : {}),
    ...(sourcedClaims.length ? { provenance: sourcedClaims } : {}),
    ...(parsedAlternatives.length ? { alternatives: parsedAlternatives } : {}),
  };
}
