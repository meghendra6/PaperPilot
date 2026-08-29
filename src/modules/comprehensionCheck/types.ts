export type MasteryPhase =
  | "idle"
  | "generating-question"
  | "awaiting-answer"
  | "evaluating"
  | "complete";

export interface MasteryTopic {
  topic: string;
  understood: boolean;
  confidence: number;
  difficulty?: "foundational" | "intermediate" | "advanced";
}

export interface MasteryRound {
  question: string;
  userAnswer: string;
  evaluation: string;
  understood: boolean;
  explanation?: string;
  topic?: string;
  difficulty?: "foundational" | "intermediate" | "advanced";
  learnerConfidence?: number;
  graderConfidence?: number;
  normalizedScore?: number;
  misunderstandings?: string[];
  criterionScores?: MasteryCriterionScore[];
  evaluatedAt?: string;
}

export interface MasteryCriterionScore {
  criterionID: "accuracy" | "completeness" | "evidence" | "reasoning";
  score: number;
  maxScore: 2;
  feedback: string;
  origin: "model" | "legacy-inferred";
}

export interface MasteryReviewSchedule {
  algorithmVersion: "paperpilot-mastery-scheduler-v1";
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  lastReviewedAt: string;
  nextReviewAt: string;
}

export interface MasterySummary {
  averageScore: number;
  calibration: number | null;
  openMisconceptions: string[];
  nextReviewAt?: string;
}

export interface MasterySourceSnapshot {
  itemID: number;
  libraryID?: number;
  itemKey?: string;
  attachmentKey?: string;
  contentFingerprint?: string;
}

export interface ComprehensionCheckState {
  schemaVersion?: 2;
  revision?: number;
  sessionID?: string;
  sourceSnapshot?: MasterySourceSnapshot;
  phase: MasteryPhase;
  running: boolean;
  status: string;
  rounds: MasteryRound[];
  topics: MasteryTopic[];
  currentQuestion?: string;
  finalReport?: string;
  finalReportError?: string;
  schedule?: MasteryReviewSchedule;
  summary?: MasterySummary;
  createdAt?: string;
  updatedAt?: string;
}
