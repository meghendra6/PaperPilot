// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
const clamp01 = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
};
function createCrossPaperMasterySession(params) {
  const conceptIds = new Set();
  const concepts = params.concepts.map((concept) => {
    if (!concept.id || conceptIds.has(concept.id))
      throw new Error(`Missing or duplicate concept ${concept.id}`);
    conceptIds.add(concept.id);
    const paperKeys = [...new Set(concept.paperKeys)];
    if (paperKeys.length < 2)
      throw new Error(
        `Cross-paper concept ${concept.id} needs at least two papers.`,
      );
    return { ...concept, paperKeys };
  });
  const now = params.now ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    id: params.id,
    collectionKey: params.collectionKey,
    concepts,
    questions: [],
    attempts: [],
    createdAt: now,
    updatedAt: now,
  };
}
function addCrossPaperQuestion(
  session,
  question,
  now = new Date().toISOString(),
) {
  if (!session.concepts.some((concept) => concept.id === question.conceptId))
    throw new Error(`Unknown concept ${question.conceptId}`);
  if (session.questions.some((entry) => entry.id === question.id))
    throw new Error(`Duplicate question ${question.id}`);
  return {
    ...session,
    questions: [...session.questions, question],
    updatedAt: now,
  };
}
function addCrossPaperAttempt(
  session,
  attempt,
  now = new Date().toISOString(),
) {
  const question = session.questions.find(
    (entry) => entry.id === attempt.questionId,
  );
  if (!question) throw new Error(`Unknown question ${attempt.questionId}`);
  if (session.attempts.some((entry) => entry.id === attempt.id))
    throw new Error(`Duplicate attempt ${attempt.id}`);
  const allowed = new Map(
    question.rubric.map((criterion) => [criterion.id, criterion.maxScore]),
  );
  const seen = new Set();
  const grades = attempt.grades.map((grade) => {
    const maximum = allowed.get(grade.criterionId);
    if (maximum === undefined || seen.has(grade.criterionId))
      throw new Error(`Unknown or duplicate criterion ${grade.criterionId}`);
    seen.add(grade.criterionId);
    return {
      ...grade,
      maxScore: maximum,
      score: Math.max(0, Math.min(maximum, Number(grade.score) || 0)),
    };
  });
  for (const criterionId of allowed.keys())
    if (!seen.has(criterionId))
      throw new Error(`Missing criterion ${criterionId}`);
  return {
    ...session,
    attempts: [
      ...session.attempts,
      {
        ...attempt,
        grades,
        learnerConfidence: clamp01(attempt.learnerConfidence),
        graderConfidence: clamp01(attempt.graderConfidence),
      },
    ],
    updatedAt: now,
  };
}
function scoreCrossPaperAttempt(question, attempt) {
  const maxScore = question.rubric.reduce(
    (sum, criterion) => sum + criterion.maxScore,
    0,
  );
  if (!maxScore) return 0;
  const scores = new Map(
    attempt.grades.map((grade) => [grade.criterionId, grade.score]),
  );
  return (
    question.rubric.reduce(
      (sum, criterion) =>
        sum +
        Math.max(
          0,
          Math.min(criterion.maxScore, scores.get(criterion.id) ?? 0),
        ),
      0,
    ) / maxScore
  );
}
function summarizeCrossPaperMastery(session) {
  const attemptedQuestionIds = new Set(
    session.attempts.map((attempt) => attempt.questionId),
  );
  const attemptedConceptIds = new Set(
    session.questions
      .filter((question) => attemptedQuestionIds.has(question.id))
      .map((question) => question.conceptId),
  );
  const ratios = session.attempts.map((attempt) => {
    const question = session.questions.find(
      (entry) => entry.id === attempt.questionId,
    );
    return question ? scoreCrossPaperAttempt(question, attempt) : 0;
  });
  const calibrationErrors = session.attempts.map((attempt, index) =>
    Math.abs(attempt.learnerConfidence - ratios[index]),
  );
  return {
    conceptCoverage: session.concepts.length
      ? attemptedConceptIds.size / session.concepts.length
      : 0,
    questionCoverage: session.questions.length
      ? attemptedQuestionIds.size / session.questions.length
      : 0,
    answerQuality: ratios.length
      ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length
      : 0,
    calibration: calibrationErrors.length
      ? 1 -
        calibrationErrors.reduce((sum, value) => sum + value, 0) /
          calibrationErrors.length
      : null,
    openMisconceptions: [
      ...new Set(
        session.attempts
          .flatMap((attempt) => attempt.misconceptions)
          .filter(Boolean),
      ),
    ],
  };
}
function gradeCrossPaperAnswer(question, input) {
  const byId = new Map(
    input.criterionScores.map((score) => [score.criterionId, score]),
  );
  const scores = question.rubric.map((criterion) => {
    const raw = byId.get(criterion.id);
    return {
      criterionId: criterion.id,
      score: Math.max(0, Math.min(criterion.maxScore, Number(raw?.score) || 0)),
      maxScore: criterion.maxScore,
      feedback: String(raw?.feedback || ""),
      evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    };
  });
  return {
    questionId: question.id,
    scores,
    totalScore: scores.reduce((sum, score) => sum + score.score, 0),
    maxScore: scores.reduce((sum, score) => sum + score.maxScore, 0),
    feedback: input.feedback,
    misconceptions: (input.misconceptions || []).filter(Boolean),
    graderConfidence: clamp01(input.graderConfidence),
  };
}
function crossPaperGradeRatio(grade) {
  return grade.maxScore ? grade.totalScore / grade.maxScore : 0;
}

export {
  createCrossPaperMasterySession,
  addCrossPaperQuestion,
  addCrossPaperAttempt,
  scoreCrossPaperAttempt,
  summarizeCrossPaperMastery,
  gradeCrossPaperAnswer,
  crossPaperGradeRatio,
};
