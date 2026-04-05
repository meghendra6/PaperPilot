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
}

export interface MasteryRound {
  question: string;
  userAnswer: string;
  evaluation: string;
  understood: boolean;
  explanation?: string;
}

export interface ComprehensionCheckState {
  phase: MasteryPhase;
  running: boolean;
  status: string;
  rounds: MasteryRound[];
  topics: MasteryTopic[];
  currentQuestion?: string;
}