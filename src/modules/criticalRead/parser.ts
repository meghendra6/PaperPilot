import type {
  CriticalReadAgentOutput,
  CriticalReadMethodAreaCode,
  CriticalReadStepID,
} from "./types";

const METHOD_AREA_CODES = new Set<CriticalReadMethodAreaCode>([
  "data_provenance",
  "data_splits",
  "baselines",
  "metrics",
  "controls",
  "assumptions_validity",
  "statistics",
  "reproducibility",
  "scope_alignment",
]);

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
      const areaCode = text(entry.areaCode) as CriticalReadMethodAreaCode;
      const area = text(entry.area);
      const finding = text(entry.finding);
      const status = text(entry.status);
      if (
        !METHOD_AREA_CODES.has(areaCode) ||
        !area ||
        !finding ||
        !statuses.has(status)
      ) {
        return [];
      }
      return [
        {
          areaCode,
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

function requiredTextObject<T extends string>(
  value: unknown,
  keys: readonly T[],
): Record<T, string> | undefined {
  if (!record(value)) return undefined;
  const output = Object.fromEntries(
    keys.map((key) => [key, text(value[key])]),
  ) as Record<T, string> | undefined;
  return keys.every((key) => output?.[key]) ? output : undefined;
}

function scanObservations(value: unknown) {
  if (!record(value)) return undefined;
  const abstractSignal = text(value.abstractSignal);
  const figureTableSignals = list(value.figureTableSignals, 12);
  const openQuestions = list(value.openQuestions, 12);
  if (!abstractSignal || !figureTableSignals.length || !openQuestions.length) {
    return undefined;
  }
  return { abstractSignal, figureTableSignals, openQuestions };
}

function evidenceConclusion(value: unknown) {
  if (!record(value)) return undefined;
  const supports = list(value.supports, 12);
  const doesNotSupport = list(value.doesNotSupport, 12);
  const strongestResult = text(value.strongestResult);
  const weakestResult = text(value.weakestResult);
  const confidence = text(value.confidence);
  if (
    !supports.length ||
    !doesNotSupport.length ||
    !strongestResult ||
    !weakestResult ||
    !["high", "medium", "low", "unclear"].includes(confidence)
  ) {
    return undefined;
  }
  return {
    supports,
    doesNotSupport,
    strongestResult,
    weakestResult,
    confidence: confidence as "high" | "medium" | "low" | "unclear",
  };
}

function authorComparison(value: unknown) {
  if (!record(value)) return undefined;
  const keys = [
    "agreements",
    "readerOmissions",
    "strongerAuthorClaims",
    "authorCaveats",
    "interpretiveDifferences",
  ] as const;
  if (keys.some((key) => !Array.isArray(value[key]))) return undefined;
  const authorConclusionStatus = text(value.authorConclusionStatus);
  if (
    authorConclusionStatus !== "available" &&
    authorConclusionStatus !== "unavailable"
  ) {
    return undefined;
  }
  const unavailableReason = text(value.unavailableReason) || undefined;
  if (authorConclusionStatus === "unavailable" && !unavailableReason) {
    return undefined;
  }
  return {
    authorConclusionStatus: authorConclusionStatus as
      | "available"
      | "unavailable",
    unavailableReason,
    agreements: list(value.agreements, 12),
    readerOmissions: list(value.readerOmissions, 12),
    strongerAuthorClaims: list(value.strongerAuthorClaims, 12),
    authorCaveats: list(value.authorCaveats, 12),
    interpretiveDifferences: list(value.interpretiveDifferences, 12),
  };
}

function comparison(value: unknown) {
  if (!record(value)) return undefined;
  if (
    !Array.isArray(value.agreements) ||
    !Array.isArray(value.differences) ||
    !Array.isArray(value.unresolved)
  ) {
    return undefined;
  }
  return {
    agreements: list(value.agreements, 12),
    differences: list(value.differences, 12),
    unresolved: list(value.unresolved, 12),
  };
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
  const parsedScan = scanObservations(parsed.scanObservations);
  const parsedResearchQuestion = requiredTextObject(parsed.researchQuestion, [
    "question",
    "problem",
    "setting",
    "claimedGap",
    "readerComparison",
  ] as const);
  const parsedConclusion = evidenceConclusion(parsed.evidenceConclusion);
  const parsedAuthorComparison = authorComparison(parsed.authorComparison);
  const parsedMethodComparison = comparison(parsed.methodComparison);
  const parsedFinalSynthesis = requiredTextObject(parsed.finalSynthesis, [
    "strongestSupportedClaim",
    "keyResidualUncertainty",
    "nextReadingOrExperiment",
  ] as const);
  const items = list(parsed.items, 12);
  const sourceLocators = list(parsed.sourceLocators, 12);
  const limitations = list(parsed.limitations, 8);
  if (stepID === 1 && (!parsedScan || !items.length)) {
    throw new Error(
      "Critical Read Step 1 must record abstract, figure/table, and open-question observations.",
    );
  }
  if (stepID === 2 && (!parsedResearchQuestion || !items.length)) {
    throw new Error(
      "Critical Read Step 2 must identify the question, problem, setting, claimed gap, and reader comparison.",
    );
  }
  if (stepID === 4) {
    const observedCodes = new Set(checks.map((entry) => entry.areaCode));
    if ([...METHOD_AREA_CODES].some((code) => !observedCodes.has(code))) {
      throw new Error(
        "Critical Read Step 4 must classify every locale-independent methodology area code.",
      );
    }
    if (
      !items.length ||
      !parsedMethodComparison ||
      ![
        ...parsedMethodComparison.agreements,
        ...parsedMethodComparison.differences,
        ...parsedMethodComparison.unresolved,
      ].length
    ) {
      throw new Error(
        "Critical Read Step 4 must compare the reader assessment with the agent's independent method evaluation.",
      );
    }
  }
  if (stepID === 5 && (!parsedConclusion || !items.length)) {
    throw new Error(
      "Critical Read Step 5 must separate supported and unsupported conclusions, strongest and weakest results, and confidence.",
    );
  }
  if (
    stepID === 6 &&
    (!parsedAuthorComparison ||
      !sourcedClaims.some((entry) => entry.source === "agent_inference") ||
      (parsedAuthorComparison.authorConclusionStatus === "available" &&
        (!sourcedClaims.some((entry) => entry.source === "paper_claim") ||
          ![
            ...parsedAuthorComparison.agreements,
            ...parsedAuthorComparison.readerOmissions,
            ...parsedAuthorComparison.strongerAuthorClaims,
            ...parsedAuthorComparison.authorCaveats,
            ...parsedAuthorComparison.interpretiveDifferences,
          ].length)) ||
      (parsedAuthorComparison.authorConclusionStatus === "unavailable" &&
        !limitations.length))
  ) {
    throw new Error(
      "Critical Read Step 6 must complete every comparison category and mark agent inference explicitly.",
    );
  }
  if (stepID === 7 && (!parsedAlternatives.length || !parsedFinalSynthesis)) {
    throw new Error(
      "Critical Read Step 7 must include an alternative and a discriminating experiment.",
    );
  }
  return {
    summary: text(parsed.summary),
    items,
    sourceLocators,
    limitations,
    ...(parsedScan ? { scanObservations: parsedScan } : {}),
    ...(parsedResearchQuestion
      ? { researchQuestion: parsedResearchQuestion }
      : {}),
    ...(checks.length ? { methodChecks: checks } : {}),
    ...(parsedMethodComparison
      ? { methodComparison: parsedMethodComparison }
      : {}),
    ...(sourcedClaims.length ? { provenance: sourcedClaims } : {}),
    ...(parsedConclusion ? { evidenceConclusion: parsedConclusion } : {}),
    ...(parsedAuthorComparison
      ? { authorComparison: parsedAuthorComparison }
      : {}),
    ...(parsedAlternatives.length ? { alternatives: parsedAlternatives } : {}),
    ...(parsedFinalSynthesis ? { finalSynthesis: parsedFinalSynthesis } : {}),
  };
}
