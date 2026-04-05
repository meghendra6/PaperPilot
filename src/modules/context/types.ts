export interface ContextPayload {
  selectedText?: string;
  surroundingText?: string;
  pageNumber?: number;
  annotationIDs?: string[];
  retrievedChunks: string[];
  recentTurns?: Array<{ role: string; text: string }>;
  promptPreview: string;
}
