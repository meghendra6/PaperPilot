import type { PDFTextSpan } from "../autoHighlight/types";
import type { FigureLabelKind, FigureLocatorHints, PdfRect } from "./types";

/** A caption farther than this from the selected area is not associated. */
const MAX_CAPTION_DISTANCE = 120;
/** Body text such as "Figure 3 shows" ranks below "Figure 3:" captions. */
const UNPUNCTUATED_CAPTION_PENALTY = 36;
const MAX_CAPTION_LINES = 8;
const MAX_CAPTION_CHARACTERS = 800;
const MAX_REGION_ROWS = 80;
const MAX_REGION_CHARACTERS = 4_000;
/** Points of slack around the selection when testing span centers. */
const REGION_TOLERANCE = 2;
const MIN_COLUMN_GAP = 6;

// Case variants are listed explicitly so that "Figures 3" is not a label.
// Numbers: 3, 2b, 4.1, S1, A.2, and the Roman numerals of IEEE tables.
const CAPTION_LABEL =
  /^\s*(Figure|FIGURE|Fig\.?|FIG\.?|Table|TABLE|Tab\.?|TAB\.?|Algorithm|ALGORITHM|Alg\.?|그림|표|图|表)\s*(\d+(?:\.\d+)*[a-z]?|[A-Z]\.?\d+(?:\.\d+)*[a-z]?|[IVXLC]+)(?![\p{L}\p{N}])/u;
const CAPTION_PUNCTUATION = /^\s*[:.|\-–—]/u;

export interface CaptionLabel {
  label: string;
  kind: FigureLabelKind;
  punctuated: boolean;
}

interface TextRow {
  spans: PDFTextSpan[];
  center: number;
  height: number;
}

interface TextSegment {
  text: string;
  rect: PdfRect;
  height: number;
}

function labelWord(word: string): { word: string; kind: FigureLabelKind } {
  const normalized = word.replace(/\.$/, "").toLowerCase();
  if (["figure", "fig", "그림", "图"].includes(normalized))
    return { word: /^[a-z]/i.test(word) ? "Figure" : word, kind: "figure" };
  if (["table", "tab", "표", "表"].includes(normalized))
    return { word: /^[a-z]/i.test(word) ? "Table" : word, kind: "table" };
  if (["algorithm", "alg"].includes(normalized))
    return { word: "Algorithm", kind: "algorithm" };
  return { word, kind: "other" };
}

/** Reads a leading "Figure 3:" style label; returns undefined for body text. */
export function parseCaptionLabel(text: string): CaptionLabel | undefined {
  const match = CAPTION_LABEL.exec(text);
  if (!match) return undefined;
  const { word, kind } = labelWord(match[1]);
  return {
    label: `${word} ${match[2]}`,
    kind,
    punctuated: CAPTION_PUNCTUATION.test(text.slice(match[0].length)),
  };
}

/** Accepts one Zotero position rect in any corner order. */
export function normalizePdfRect(value: unknown): PdfRect | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined;
  const numbers = value.slice(0, 4).map(Number);
  if (!numbers.every(Number.isFinite)) return undefined;
  const [x1, y1, x2, y2] = numbers;
  const rect: PdfRect = [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
  return rect[2] - rect[0] > 0 && rect[3] - rect[1] > 0 ? rect : undefined;
}

function spanHeight(span: PDFTextSpan) {
  return Math.max(0.1, span.rect[3] - span.rect[1]);
}

function spanCenterY(span: PDFTextSpan) {
  return (span.rect[1] + span.rect[3]) / 2;
}

function groupRows(spans: readonly PDFTextSpan[]): TextRow[] {
  const sorted = [...spans].sort(
    (left, right) =>
      spanCenterY(right) - spanCenterY(left) || left.rect[0] - right.rect[0],
  );
  const rows: TextRow[] = [];
  for (const span of sorted) {
    const center = spanCenterY(span);
    const height = spanHeight(span);
    const row = rows.at(-1);
    if (
      row &&
      Math.abs(row.center - center) <= Math.max(row.height, height) / 2
    )
      row.spans.push(span);
    else rows.push({ spans: [span], center, height });
  }
  for (const row of rows) row.spans.sort((a, b) => a.rect[0] - b.rect[0]);
  return rows;
}

function joinSpans(spans: readonly PDFTextSpan[], cellSeparator: string) {
  let text = "";
  spans.forEach((span, index) => {
    if (index > 0) {
      const previous = spans[index - 1];
      const gap = span.rect[0] - previous.rect[2];
      const height = Math.max(spanHeight(previous), spanHeight(span));
      text += gap > height ? cellSeparator : gap > height * 0.15 ? " " : "";
    }
    text += span.text;
  });
  return text.replace(/\s+/g, " ").trim();
}

function unionRect(spans: readonly PDFTextSpan[]): PdfRect {
  return [
    Math.min(...spans.map((span) => span.rect[0])),
    Math.min(...spans.map((span) => span.rect[1])),
    Math.max(...spans.map((span) => span.rect[2])),
    Math.max(...spans.map((span) => span.rect[3])),
  ];
}

/** Splits rows at column gutters so two-column pages keep columns apart. */
function buildSegments(rows: readonly TextRow[]): TextSegment[] {
  const segments: TextSegment[] = [];
  for (const row of rows) {
    let current: PDFTextSpan[] = [];
    const flush = () => {
      if (!current.length) return;
      const text = joinSpans(current, " ");
      if (text)
        segments.push({ text, rect: unionRect(current), height: row.height });
      current = [];
    };
    for (const span of row.spans) {
      const previous = current.at(-1);
      if (
        previous &&
        span.rect[0] - previous.rect[2] >
          Math.max(MIN_COLUMN_GAP, Math.max(row.height, spanHeight(span)))
      )
        flush();
      current.push(span);
    }
    flush();
  }
  return segments;
}

function horizontalOverlap(left: PdfRect, right: PdfRect) {
  return Math.min(left[2], right[2]) - Math.max(left[0], right[0]);
}

function verticalDistance(segment: PdfRect, region: PdfRect) {
  if (segment[3] < region[1]) return region[1] - segment[3];
  if (segment[1] > region[3]) return segment[1] - region[3];
  return 0;
}

function findCaptionSegment(segments: readonly TextSegment[], region: PdfRect) {
  const widened: PdfRect = [
    region[0] - 12,
    region[1],
    region[2] + 12,
    region[3],
  ];
  let best:
    | { segment: TextSegment; label: CaptionLabel; score: number }
    | undefined;
  for (const segment of segments) {
    const label = parseCaptionLabel(segment.text);
    if (!label || horizontalOverlap(segment.rect, widened) <= 0) continue;
    const distance = verticalDistance(segment.rect, region);
    if (distance > MAX_CAPTION_DISTANCE) continue;
    const score =
      distance + (label.punctuated ? 0 : UNPUNCTUATED_CAPTION_PENALTY);
    // Segments arrive top to bottom, so ties keep the upper caption.
    if (!best || score < best.score) best = { segment, label, score };
  }
  return best;
}

function collectCaption(
  segments: readonly TextSegment[],
  first: TextSegment,
  region: PdfRect,
) {
  const insideRegion = verticalDistance(first.rect, region) === 0;
  const lines = [first];
  let current = first;
  let length = first.text.length;
  while (lines.length < MAX_CAPTION_LINES && length < MAX_CAPTION_CHARACTERS) {
    const tolerance = current.height * 0.3;
    const next = segments
      .filter(
        (segment) =>
          !lines.includes(segment) &&
          segment.rect[3] <= current.rect[1] + tolerance &&
          horizontalOverlap(segment.rect, first.rect) > 0,
      )
      .sort((left, right) => right.rect[3] - left.rect[3])[0];
    if (!next || current.rect[1] - next.rect[3] > current.height * 1.5) break;
    if (parseCaptionLabel(next.text)) break;
    if (!insideRegion && verticalDistance(next.rect, region) === 0) break;
    lines.push(next);
    length += next.text.length + 1;
    current = next;
  }
  return lines
    .map((line) => line.text)
    .join(" ")
    .replace(/(\p{L})-\s+(\p{Ll})/gu, "$1$2")
    .slice(0, MAX_CAPTION_CHARACTERS)
    .trim();
}

function collectRegionText(spans: readonly PDFTextSpan[], region: PdfRect) {
  const inside = spans.filter((span) => {
    const x = (span.rect[0] + span.rect[2]) / 2;
    const y = spanCenterY(span);
    return (
      x >= region[0] - REGION_TOLERANCE &&
      x <= region[2] + REGION_TOLERANCE &&
      y >= region[1] - REGION_TOLERANCE &&
      y <= region[3] + REGION_TOLERANCE
    );
  });
  const rows = groupRows(inside)
    .slice(0, MAX_REGION_ROWS)
    .map((row) => joinSpans(row.spans, " | "))
    .filter(Boolean);
  const text = rows.join("\n");
  return text.length > MAX_REGION_CHARACTERS
    ? `${text.slice(0, MAX_REGION_CHARACTERS).trimEnd()}…`
    : text;
}

/**
 * Finds the caption and the text printed inside one selected page area.
 * The result is a locator hint for the engine, not verified evidence.
 */
export function locateFigureContext(
  pageSpans: readonly PDFTextSpan[],
  region: PdfRect,
): FigureLocatorHints {
  const segments = buildSegments(groupRows(pageSpans));
  const caption = findCaptionSegment(segments, region);
  const regionText = collectRegionText(pageSpans, region);
  return {
    ...(caption
      ? {
          label: caption.label.label,
          labelKind: caption.label.kind,
          caption: collectCaption(segments, caption.segment, region),
        }
      : {}),
    ...(regionText ? { regionText } : {}),
  };
}
