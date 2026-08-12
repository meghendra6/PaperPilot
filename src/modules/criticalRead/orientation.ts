import type { CriticalReadStepState } from "./types";

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function extractCaptionIndex(text: string) {
  return lines(text)
    .filter((line) => /^(figure|fig\.?|table)\s*[A-Z0-9]+[.:\s-]/i.test(line))
    .filter((line) => line.length >= 12)
    .slice(0, 24);
}

function extractSectionLocations(text: string, pattern: RegExp) {
  return lines(text)
    .filter((line) => line.length < 140 && pattern.test(line))
    .slice(0, 12);
}

export function buildCriticalReadOrientations(params: {
  markdownText?: string;
  fullText?: string;
  structuredContent?: unknown;
  extractionMethod?: string;
  abstract?: string;
}): Partial<Record<1 | 4 | 5, CriticalReadStepState["orientation"]>> {
  const text = params.markdownText || params.fullText || "";
  const captions = extractCaptionIndex(text);
  const hasStructuredContent = Boolean(params.structuredContent);
  const extractionMode = captions.length
    ? hasStructuredContent
      ? ("structured-captions" as const)
      : ("caption-text" as const)
    : ("text-only" as const);
  const notice = captions.length
    ? "Caption index extracted from paper text. Paper Pilot has not visually inspected the figure pixels in this step."
    : "Degraded extraction: no structured figure/table captions were found. The figure pixels were not visually inspected; use the open PDF directly.";
  const methodLocations = extractSectionLocations(
    text,
    /^(#+\s*)?(method|methodology|approach|experimental setup|materials and methods)\b/i,
  );
  const resultLocations = extractSectionLocations(
    text,
    /^(#+\s*)?(result|results|evaluation|experiments|analysis)\b/i,
  );
  const abstract = params.abstract?.replace(/\s+/g, " ").trim().slice(0, 2_000);
  const shared = { extractionMode, notice, captions, abstract };
  return {
    1: { ...shared, sourceLocations: captions.slice(0, 12) },
    4: {
      ...shared,
      sourceLocations: methodLocations,
      captions: [],
    },
    5: {
      ...shared,
      sourceLocations: resultLocations,
      captions,
    },
  };
}
