// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as types_1 from "../../evidence/types";
import * as engine_1 from "./engine";
function evidenceLinks(references) {
  return references.map((reference) => ({
    label: (0, types_1.formatEvidenceLocator)(reference),
    reference: {
      ...reference,
      ...(reference.sectionPath
        ? { sectionPath: [...reference.sectionPath] }
        : {}),
      ...(reference.boundingBox
        ? { boundingBox: { ...reference.boundingBox } }
        : {}),
    },
  }));
}
/**
 * Returns the only question data that should enter the pre-answer DOM. Hidden
 * expected claims, rubric, evidence, and concept identity are deliberately absent.
 */
function toLearnerQuestionView(session) {
  const question = session.pendingQuestion;
  if (!question) return null;
  return {
    questionId: question.id,
    prompt: question.prompt,
    difficulty: question.difficulty,
    mode: question.mode,
    completedAttempts: session.attempts.length,
    totalConcepts: session.blueprint.concepts.length,
  };
}
/** Safe post-submission view; rubric descriptions become visible only here. */
function toLearnerAttemptFeedback(attempt) {
  const rubricById = new Map(
    attempt.question.rubric.map((criterion) => [criterion.id, criterion]),
  );
  return {
    attemptId: attempt.id,
    questionPrompt: attempt.question.prompt,
    normalizedScore: attempt.normalizedScore,
    passed: attempt.passed,
    overallFeedback: attempt.grade.overallFeedback,
    explanation: attempt.grade.explanation,
    graderConfidence: attempt.grade.graderConfidence,
    criteria: attempt.grade.criterionGrades.map((grade) => ({
      criterionId: grade.criterionId,
      description:
        rubricById.get(grade.criterionId)?.description ??
        "Unknown rubric criterion",
      score: grade.score,
      maxScore: rubricById.get(grade.criterionId)?.maxScore ?? grade.maxScore,
      feedback: grade.feedback,
      evidence: evidenceLinks(grade.evidence),
    })),
    misconceptions: attempt.grade.misconceptions.map((misconception) => ({
      statement: misconception.statement,
      severity: misconception.severity,
      evidence: evidenceLinks(misconception.evidence),
    })),
  };
}
function toMasteryDashboardView(session) {
  const metrics = (0, engine_1.calculateMasteryMetrics)(session);
  const completion = (0, engine_1.calculateCompletionStatus)(session);
  const nextReviews = Object.values(session.conceptStates)
    .map((state) => state.nextReviewAt)
    .filter((value) => Boolean(value))
    .sort();
  return {
    phase: session.phase,
    testedConcepts: Object.values(session.conceptStates).filter(
      (state) => state.attemptCount > 0,
    ).length,
    totalConcepts: session.blueprint.concepts.length,
    coverage: metrics.coverage,
    answerQuality: metrics.answerQuality,
    calibration: metrics.calibration,
    retention: metrics.retention,
    openMajorMisconceptions: completion.openMajorMisconceptions,
    completionReasons: [...completion.reasons],
    nextReviewAt: nextReviews[0] ?? null,
  };
}

export {
  toLearnerQuestionView,
  toLearnerAttemptFeedback,
  toMasteryDashboardView,
};
