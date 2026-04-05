import { normalizeQuoteText } from "./pdfMatch";
import type { MatchedHighlight } from "./types";

export const AUTO_HIGHLIGHT_COLOR = "#ffd400";

export interface HighlightAnnotationSavePayload {
  key: string;
  type: "highlight";
  text: string;
  color: string;
  pageLabel: string;
  sortIndex: string;
  position: {
    pageIndex: number;
    rects: number[][];
  };
}

export function buildHighlightAnnotationJSON(
  match: MatchedHighlight,
): HighlightAnnotationSavePayload {
  if (!match.rects.length) {
    throw new Error("Cannot create a highlight annotation without rects.");
  }

  const zoteroGlobal = globalThis as typeof globalThis & {
    Zotero?: {
      DataObjectUtilities?: {
        generateKey?: () => string;
      };
    };
  };
  const key = zoteroGlobal.Zotero?.DataObjectUtilities?.generateKey?.();
  if (!key) {
    throw new Error("Zotero key generator is unavailable.");
  }

  return {
    key,
    type: "highlight",
    text: match.quote,
    color: AUTO_HIGHLIGHT_COLOR,
    pageLabel: match.pageLabel,
    sortIndex: match.sortIndex,
    position: {
      pageIndex: match.pageIndex,
      rects: match.rects,
    },
  };
}

export function isDuplicateHighlight(
  existingAnnotations:
    | Array<{
        annotationType?: string;
        annotationText?: string;
        annotationPosition?: string;
      }>
    | {
        annotationType?: string;
        annotationText?: string;
        annotationPosition?: string;
      },
  match: MatchedHighlight,
) {
  const annotations = Array.isArray(existingAnnotations)
    ? existingAnnotations
    : [existingAnnotations];

  return annotations.some((annotation) => {
    if (!annotation || annotation.annotationType !== "highlight") {
      return false;
    }

    let pageIndex: number | undefined;
    try {
      const position = JSON.parse(
        String(annotation.annotationPosition || "{}"),
      ) as {
        pageIndex?: number;
      };
      pageIndex = position.pageIndex;
    } catch {
      pageIndex = undefined;
    }

    return (
      pageIndex === match.pageIndex &&
      normalizeQuoteText(String(annotation.annotationText || "")) ===
        match.normalizedQuote
    );
  });
}
