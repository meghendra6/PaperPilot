export interface HighlightCandidate {
  quote: string;
}

export interface PDFTextSpan {
  pageIndex: number;
  pageLabel: string;
  text: string;
  normalizedText: string;
  rect: number[];
}

export interface PDFPageText {
  pageIndex: number;
  pageLabel: string;
  spans: PDFTextSpan[];
  /** Page view height in PDF units, when the extractor knows it. */
  height?: number;
}

export interface MatchedHighlight {
  /** Exact display text reconstructed from the locally matched PDF spans. */
  quote: string;
  normalizedQuote: string;
  pageIndex: number;
  pageLabel: string;
  rects: number[][];
  sortIndex: string;
}

export interface AutoHighlightResult {
  created: number;
  skipped: number;
  unmatched: number;
  totalCandidates: number;
}
