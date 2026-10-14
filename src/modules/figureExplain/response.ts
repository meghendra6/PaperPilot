import { tryParseFirstJsonObject } from "../ai/jsonCandidates";
import { FIGURE_EVIDENCE_BASES, FIGURE_KINDS, FIGURE_LIMITS } from "./prompt";
import type {
  FigureEvidenceBasis,
  FigureExplanation,
  FigureKeyPoint,
  FigureKind,
} from "./types";

function boundedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1).trimEnd()}…`
    : text;
}

function boundedList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => boundedText(entry, FIGURE_LIMITS.item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeKind(value: unknown): FigureKind {
  return (FIGURE_KINDS as readonly unknown[]).includes(value)
    ? (value as FigureKind)
    : "other";
}

// An unknown basis must not read as a visual observation or a paper claim.
function normalizeBasis(value: unknown): FigureEvidenceBasis {
  return (FIGURE_EVIDENCE_BASES as readonly unknown[]).includes(value)
    ? (value as FigureEvidenceBasis)
    : "inference";
}

function normalizeKeyPoints(value: unknown): FigureKeyPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record: Record<string, unknown> =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : { text: entry };
      const text = boundedText(record.text, FIGURE_LIMITS.item);
      return text ? { text, basis: normalizeBasis(record.basis) } : undefined;
    })
    .filter((entry): entry is FigureKeyPoint => Boolean(entry))
    .slice(0, FIGURE_LIMITS.keyPoints);
}

function normalizeExplanation(
  record: Record<string, unknown>,
): FigureExplanation | undefined {
  const summary = boundedText(record.summary, FIGURE_LIMITS.summary);
  const keyPoints = normalizeKeyPoints(record.keyPoints);
  if (!summary || !keyPoints.length) return undefined;
  const label = boundedText(record.label, FIGURE_LIMITS.label);
  return {
    kind: normalizeKind(record.kind),
    label,
    title: boundedText(record.title, FIGURE_LIMITS.title) || label,
    summary,
    howToRead: boundedList(record.howToRead, FIGURE_LIMITS.howToRead),
    keyPoints,
    paperContext: boundedText(record.paperContext, FIGURE_LIMITS.paperContext),
    caveats: boundedList(record.caveats, FIGURE_LIMITS.caveats),
  };
}

/** Accepts fenced or prefixed JSON; rejects output without a usable answer. */
export function parseFigureExplanationResponse(raw: string): FigureExplanation {
  const parsed = tryParseFirstJsonObject(raw, (value) =>
    normalizeExplanation(value as Record<string, unknown>),
  );
  if (!parsed)
    throw new Error(
      "The engine did not return a readable figure explanation. Retry the request.",
    );
  return parsed;
}
