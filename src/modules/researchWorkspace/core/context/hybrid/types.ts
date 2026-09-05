export interface HybridChunk {
  id: string;
  text: string;
  title?: string;
  pageIndex?: number;
  sectionPath?: string[];
  attachmentKey?: string;
  metadata?: Record<string, unknown>;
}
export interface HybridIndexInput {
  chunks: HybridChunk[];
  documentKey?: string;
  paperKey?: string;
  attachmentKey?: string;
  sourceFingerprint?: string;
  embeddingDimensions?: number;
  now?: string;
}
export interface HybridSearchOptions {
  topK?: number;
  preferredSections?: string[];
  sectionHints?: string[];
  lexicalWeight?: number;
  semanticWeight?: number;
  titleWeight?: number;
  exactWeight?: number;
  sectionWeight?: number;
  candidateMultiplier?: number;
  mmrLambda?: number;
}
export type HybridIndex = ReturnType<typeof import("./index").buildHybridIndex>;
export interface RetrievalEvaluationCase {
  id: string;
  query: string;
  relevantChunkIds: string[];
}
