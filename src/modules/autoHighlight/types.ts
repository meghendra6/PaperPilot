export interface HighlightCandidate {
  quote: string;
  reason?: string;
  importance?: number;
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
}

export interface MatchedHighlight {
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
