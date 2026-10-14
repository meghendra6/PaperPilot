/** PDF user-space rectangle `[left, bottom, right, top]` in points. */
export type PdfRect = readonly [number, number, number, number];

export type FigureKind = "table" | "chart" | "diagram" | "image" | "other";

/** Where a statement comes from: the pixels, the paper text, or the model. */
export type FigureEvidenceBasis = "visual" | "paper-text" | "inference";

export type FigureLabelKind = "figure" | "table" | "algorithm" | "other";

/** One Zotero image annotation drawn with the reader's area tool. */
export interface FigureRegion {
  /** Parent paper item; the run reservation and engine mode use this ID. */
  itemID: number;
  attachmentID: number;
  libraryID: number;
  annotationKey: string;
  pageIndex: number;
  pageLabel: string;
  rect: PdfRect;
  comment: string;
  dateModified: string;
}

/** Deterministic, non-authoritative hints computed from local PDF text. */
export interface FigureLocatorHints {
  label?: string;
  labelKind?: FigureLabelKind;
  caption?: string;
  regionText?: string;
}

export interface FigureKeyPoint {
  text: string;
  basis: FigureEvidenceBasis;
}

export interface FigureExplanation {
  kind: FigureKind;
  label: string;
  title: string;
  summary: string;
  howToRead: string[];
  keyPoints: FigureKeyPoint[];
  paperContext: string;
  caveats: string[];
}
