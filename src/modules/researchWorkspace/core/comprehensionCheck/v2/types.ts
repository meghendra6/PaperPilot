import type { EvidenceReference } from "../../evidence/types";
export const MASTERY_SCHEMA_VERSION = 2;
export interface Clock {
  now(): Date;
}
export interface IdFactory {
  next(prefix: string): string;
}
export interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  essential: boolean;
  evidence: EvidenceReference[];
}
export interface ExpectedClaim {
  id: string;
  text: string;
  required: boolean;
  evidence: EvidenceReference[];
}
export interface MasteryConcept {
  id: string;
  name: string;
  dimension: string;
  importance: string;
  learningObjective: string;
  prerequisites: string[];
  expectedClaims: ExpectedClaim[];
  evidence: EvidenceReference[];
  rubric: RubricCriterion[];
}
export interface MasteryBlueprint {
  paperTitle?: string;
  concepts: MasteryConcept[];
}
export interface MasteryQuestion {
  id: string;
  conceptId: string;
  difficulty: string;
  mode: string;
  prompt: string;
  expectedClaims: ExpectedClaim[];
  rubric: RubricCriterion[];
  evidence: EvidenceReference[];
}
export interface CriterionGrade {
  criterionId: string;
  score: number;
  maxScore: number;
  feedback: string;
  evidence: EvidenceReference[];
}
export interface GradedMisconception {
  statement: string;
  severity: string;
  evidence: EvidenceReference[];
}
export interface MasteryGrade {
  criterionGrades: CriterionGrade[];
  misconceptions: GradedMisconception[];
  overallFeedback: string;
  explanation: string;
  graderConfidence: number;
}
export interface MasteryAttempt {
  id: string;
  question: MasteryQuestion;
  answer: string;
  learnerConfidence?: number;
  grade: MasteryGrade;
  normalizedScore: number;
  passed: boolean;
  hintLevel: number;
  startedAt: string;
  submittedAt: string;
  retryOf?: string;
  delayedReview: boolean;
}
export interface ConceptState {
  conceptId: string;
  status: string;
  attemptCount: number;
  bestScore: number;
  latestScore?: number;
  nextReviewAt?: string;
  lastAttemptAt?: string;
}
export interface MasteryMisconception extends GradedMisconception {
  id: string;
  conceptId: string;
  status: string;
  createdAt: string;
  repairedAt?: string;
  retestedAt?: string;
}
export interface MasterySession {
  schemaVersion: number;
  id: string;
  paperKey: string;
  phase: string;
  responseLanguage: string;
  blueprint: MasteryBlueprint;
  conceptStates: Record<string, ConceptState>;
  attempts: MasteryAttempt[];
  misconceptions: MasteryMisconception[];
  pendingQuestion?: MasteryQuestion;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
export interface MasteryValidationOptions {
  expectedAttachmentKey?: string;
  pageCount?: number;
  maxConcepts?: number;
  requireAllDimensions?: boolean;
}
export interface MasteryStartInput {
  paperKey: string;
  paperContext: string;
  paperTitle?: string;
  attachmentKey: string;
  responseLanguage: string;
  maxConcepts?: number;
  pageCount?: number;
  requireAllDimensions?: boolean;
}
export interface MasteryAnswerInput {
  answer: string;
  learnerConfidence?: number;
  hintLevel?: number;
  retryOf?: string;
  delayedReview?: boolean;
  startedAt?: string;
}
export interface MasteryControllerDependencies {
  clock: Clock;
  idFactory: IdFactory;
  maxStructuredOutputAttempts?: number;
  agent: { run(prompt: string, purpose: string): Promise<string> };
  persistence: {
    load(paperKey: string): Promise<MasterySession | null>;
    save(session: MasterySession): Promise<void>;
  };
}
