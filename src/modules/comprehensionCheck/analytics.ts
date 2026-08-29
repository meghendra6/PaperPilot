import type {
  ComprehensionCheckState,
  MasteryCriterionScore,
  MasteryReviewSchedule,
  MasteryRound,
  MasterySummary,
} from "./types";
import type { MasteryDifficulty, MasteryEvaluationResponse } from "./prompt";

export const MASTERY_SCHEDULER_VERSION =
  "paperpilot-mastery-scheduler-v1" as const;

const CRITERIA = ["accuracy", "completeness", "evidence", "reasoning"] as const;

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function criterionScores(
  evaluation: MasteryEvaluationResponse,
): MasteryCriterionScore[] {
  const supplied = new Map(
    evaluation.criterionScores.map((criterion) => [
      criterion.criterionID,
      criterion,
    ]),
  );
  return CRITERIA.map((criterionID) => {
    const criterion = supplied.get(criterionID);
    if (criterion) {
      return {
        criterionID,
        score: Math.max(0, Math.min(2, criterion.score)),
        maxScore: 2,
        feedback: criterion.feedback,
        origin: "model",
      };
    }
    return {
      criterionID,
      score: evaluation.understood ? 2 : 0,
      maxScore: 2,
      feedback: evaluation.evaluation,
      origin: "legacy-inferred",
    };
  });
}

export function createCanonicalMasteryRound(params: {
  question: string;
  answer: string;
  topic?: string;
  difficulty?: MasteryDifficulty;
  learnerConfidence: number;
  evaluation: MasteryEvaluationResponse;
  now?: Date;
}): MasteryRound {
  const scores = criterionScores(params.evaluation);
  const normalizedScore =
    scores.reduce((sum, criterion) => sum + criterion.score, 0) /
    scores.reduce((sum, criterion) => sum + criterion.maxScore, 0);
  return {
    question: params.question,
    userAnswer: params.answer,
    evaluation: params.evaluation.evaluation,
    understood: params.evaluation.understood,
    explanation: params.evaluation.explanation,
    topic: params.topic,
    difficulty: params.difficulty,
    learnerConfidence: clamp01(params.learnerConfidence),
    graderConfidence: clamp01(params.evaluation.confidence),
    normalizedScore,
    misunderstandings: [...params.evaluation.misunderstandings],
    criterionScores: scores,
    evaluatedAt: (params.now ?? new Date()).toISOString(),
  };
}

export function scheduleMasteryReview(params: {
  score: number;
  previous?: MasteryReviewSchedule;
  now?: Date;
}): MasteryReviewSchedule {
  const score = clamp01(params.score);
  const previous = params.previous;
  const now = params.now ?? new Date();
  const quality = Math.round(score * 5);
  const successful = quality >= 3;
  const repetitions = successful ? (previous?.repetitions ?? 0) + 1 : 0;
  const previousEase = previous?.easeFactor ?? 2.5;
  const easeFactor = Math.max(
    1.3,
    previousEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );
  const intervalDays = !successful
    ? 1
    : repetitions === 1
      ? 1
      : repetitions === 2
        ? 6
        : Math.max(1, Math.round((previous?.intervalDays ?? 6) * easeFactor));
  return {
    algorithmVersion: MASTERY_SCHEDULER_VERSION,
    repetitions,
    intervalDays,
    easeFactor: Number(easeFactor.toFixed(3)),
    lastReviewedAt: now.toISOString(),
    nextReviewAt: new Date(
      now.getTime() + intervalDays * 24 * 60 * 60 * 1_000,
    ).toISOString(),
  };
}

export function summarizeCanonicalMastery(
  rounds: readonly MasteryRound[],
  schedule?: MasteryReviewSchedule,
): MasterySummary {
  const scores = rounds.map((round) =>
    clamp01(round.normalizedScore ?? (round.understood ? 1 : 0)),
  );
  const calibrationErrors = rounds.flatMap((round, index) =>
    typeof round.learnerConfidence === "number"
      ? [Math.abs(clamp01(round.learnerConfidence) - scores[index])]
      : [],
  );
  return {
    averageScore: scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0,
    calibration: calibrationErrors.length
      ? 1 -
        calibrationErrors.reduce((sum, error) => sum + error, 0) /
          calibrationErrors.length
      : null,
    openMisconceptions: [
      ...new Set(rounds.flatMap((round) => round.misunderstandings ?? [])),
    ],
    ...(schedule ? { nextReviewAt: schedule.nextReviewAt } : {}),
  };
}

export function updateCanonicalMasteryAnalytics(
  state: ComprehensionCheckState,
  now?: Date,
): ComprehensionCheckState {
  const last = state.rounds[state.rounds.length - 1];
  if (!last) return state;
  const schedule = scheduleMasteryReview({
    score: last.normalizedScore ?? (last.understood ? 1 : 0),
    previous: state.schedule,
    now,
  });
  return {
    ...state,
    schedule,
    summary: summarizeCanonicalMastery(state.rounds, schedule),
  };
}
