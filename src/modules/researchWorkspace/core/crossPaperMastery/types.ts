import type { scheduleMasteryReview } from "../../../comprehensionCheck/analytics";
import type { EvidenceReference } from "../evidence/types";
export interface CrossPaperConcept {
  id: string;
  name?: string;
  label?: string;
  importance?: string;
  paperKeys: string[];
  description?: string;
}
export interface CrossPaperCriterion {
  id: string;
  description: string;
  maxScore: number;
  requiredPaperKeys: string[];
  expectedClaims: string[];
  evidence: EvidenceReference[];
  paperKeys: string[];
  requiredClaims: string[];
}
export interface CrossPaperQuestion {
  id: string;
  conceptId: string;
  mode: string;
  prompt: string;
  paperKeys: string[];
  difficulty: string;
  createdAt: string;
  rubric: CrossPaperCriterion[];
  criteria: CrossPaperCriterion[];
  evidence: Record<string, EvidenceReference[]>;
}
export interface CrossPaperCriterionGrade {
  criterionId: string;
  score: number;
  maxScore: number;
  feedback: string;
  evidence: EvidenceReference[];
}
export interface CrossPaperAttempt {
  id: string;
  questionId: string;
  answer: string;
  learnerConfidence?: number;
  grades: CrossPaperCriterionGrade[];
  feedback: string;
  misconceptions: string[];
  graderConfidence?: number;
  createdAt: string;
}
export interface CrossPaperSession {
  schemaVersion: number;
  revision: number;
  id: string;
  collectionKey?: string;
  projectID?: string;
  sourceSnapshot: { sourceID: string; contentFingerprint: string }[];
  state: string;
  concepts: CrossPaperConcept[];
  questions: CrossPaperQuestion[];
  attempts: CrossPaperAttempt[];
  schedule?: ReturnType<typeof scheduleMasteryReview>;
  createdAt: string;
  updatedAt: string;
}
export interface CrossPaperParseScope {
  id?: string;
  response: string;
  allowedAttachments?: string[];
  allowedAttachmentKeys?: Set<string>;
  now?: string;
}
