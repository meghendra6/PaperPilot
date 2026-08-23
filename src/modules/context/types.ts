export interface ContextPayload {
  selectedText?: string;
  surroundingText?: string;
  pageNumber?: number;
  annotationIDs?: string[];
  retrievedChunks: string[];
  promptPreview: string;
}
