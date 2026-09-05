import type {
  EvidenceNormalizationOptions,
  EvidenceReference,
} from "./evidence/types";
export interface PaperPromptInput {
  paperContext: string;
  paperKey?: string;
  attachmentKey: string;
  sourceID?: string;
  libraryID?: number;
  responseLanguage?: string;
}
export interface PaperResponseInput {
  response: string;
  paperKey: string;
  attachmentKey: string;
  now?: string;
}
export interface CitationContext {
  id: string;
  targetClaimId?: string;
  citingPaperKey?: string;
  citedPaperKey?: string;
  text?: string;
  context?: string;
  exactSentence?: string;
  marker?: string;
  reference?: {
    title?: string;
    firstAuthor?: string;
    year?: number;
    doi?: string;
  };
  evidence?: EvidenceReference[];
}
export interface ClaimInput {
  id: string;
  text: string;
  kind: string;
  confidence?: number;
  support?: unknown;
  contradictions?: unknown;
  evidenceOptions?: EvidenceNormalizationOptions;
  verificationStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface PaperClaim
  extends Omit<ClaimInput, "support" | "contradictions" | "evidenceOptions"> {
  support: EvidenceReference[];
  contradictions: EvidenceReference[];
  verificationStatus: string;
  createdAt: string;
  updatedAt: string;
}
export interface ClaimLedger {
  schemaVersion: number;
  paperKey: string;
  claims: PaperClaim[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MatrixColumn {
  id: string;
  label: string;
  valueType: string;
  extractionQuestion?: string;
  question?: string;
  enumValues?: string[];
  requiredEvidence?: boolean;
}
export interface MatrixPaper {
  paperKey: string;
  title: string;
  attachmentKeys: string[];
}
export interface MatrixCell {
  paperKey: string;
  columnId: string;
  value: unknown;
  displayValue: string;
  status: string;
  confidence?: number;
  evidence: EvidenceReference[];
  notes?: string;
}
export interface MatrixRow {
  paperKey: string;
  attachmentKey: string;
  title: string;
  cells: MatrixCell[];
  createdAt: string;
}
export interface EvidenceMatrix {
  schemaVersion: number;
  id: string;
  title: string;
  name: string;
  columns: MatrixColumn[];
  papers: MatrixPaper[];
  cells: MatrixCell[];
  rows: MatrixRow[];
  createdAt: string;
  updatedAt: string;
}
export interface GraphNode {
  id: string;
  label: string;
  kind?: string;
  type?: string;
  paperKey?: string;
  metadata?: object;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind?: string;
  type?: string;
  label?: string;
  confidence?: number;
  evidence: EvidenceReference[];
  verified?: boolean;
  bibliographicProvenance?: object;
}
export interface LiteratureGraph {
  schemaVersion: number;
  id: string;
  title: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
}
export interface NamedArtifactInput {
  id: string;
  title?: string;
  name?: string;
  now?: string;
}
