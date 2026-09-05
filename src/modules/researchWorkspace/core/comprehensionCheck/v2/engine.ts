import * as reviewScheduler_1 from "./reviewScheduler";
import type {
  Clock,
  ConceptState,
  CriterionGrade,
  IdFactory,
  MasteryAnswerInput,
  MasteryBlueprint,
  MasteryConcept,
  MasteryGrade,
  MasteryQuestion,
  MasterySession,
} from "./types";
import * as types_1 from "./types";
function iso(clock: Clock) {
  return clock.now().toISOString();
}
function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
function conceptWeight(concept: MasteryConcept) {
  return concept.importance === "core" ? 2 : 1;
}
function createMasterySession(input: {
  clock: Clock;
  idFactory: IdFactory;
  blueprint: MasteryBlueprint;
  paperKey: string;
  responseLanguage: string;
}): MasterySession {
  const now = iso(input.clock);
  const conceptStates: Record<string, ConceptState> = {};
  for (const concept of input.blueprint.concepts) {
    conceptStates[concept.id] = {
      conceptId: concept.id,
      status: "untested",
      attemptCount: 0,
      bestScore: 0,
    };
  }
  return {
    schemaVersion: types_1.MASTERY_SCHEMA_VERSION,
    id: input.idFactory.next("mastery-session"),
    paperKey: input.paperKey,
    phase: "active",
    responseLanguage: input.responseLanguage,
    blueprint: input.blueprint,
    conceptStates,
    attempts: [],
    misconceptions: [],
    createdAt: now,
    updatedAt: now,
  };
}
function prerequisitesReady(session: MasterySession, concept: MasteryConcept) {
  return concept.prerequisites.every(
    (id) => session.conceptStates[id]?.status === "mastered",
  );
}
function openMajorMisconceptionCount(
  session: MasterySession,
  conceptId?: string,
) {
  return session.misconceptions.filter(
    (entry) =>
      entry.status === "open" &&
      entry.severity === "major" &&
      (conceptId === undefined || entry.conceptId === conceptId),
  ).length;
}
/**
 * Deterministic selection: misconceptions, due reviews, untested core concepts,
 * then weakest concepts. Pass the controller clock for time-aware review priority.
 */
function selectNextConcept(
  session: MasterySession,
  now = new Date(session.updatedAt),
) {
  if (session.phase !== "active") return null;
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs))
    throw new Error("selectNextConcept requires a valid current time.");
  const indexById = new Map(
    session.blueprint.concepts.map((concept, index) => [concept.id, index]),
  );
  const scored = session.blueprint.concepts
    .filter((concept) => prerequisitesReady(session, concept))
    .map((concept) => {
      const state = session.conceptStates[concept.id];
      if (!state) throw new Error(`Missing concept state for ${concept.id}.`);
      let priority = 0;
      priority += openMajorMisconceptionCount(session, concept.id) * 200;
      if (state.status === "untested")
        priority += concept.importance === "core" ? 120 : 70;
      if (state.status === "developing")
        priority += 80 + (1 - state.bestScore) * 50;
      if (state.status === "mastered")
        priority += Math.max(0, 20 - state.attemptCount * 5);
      if (state.nextReviewAt && Date.parse(state.nextReviewAt) <= nowMs)
        priority += 100;
      return { concept, priority, index: indexById.get(concept.id) ?? 0 };
    })
    .sort(
      (left, right) =>
        right.priority - left.priority || left.index - right.index,
    );
  return scored[0]?.concept ?? null;
}
function setPendingQuestion(
  session: MasterySession,
  question: MasteryQuestion,
  clock: Clock,
) {
  if (session.phase !== "active")
    throw new Error("Cannot add a question to an inactive session.");
  if (session.pendingQuestion)
    throw new Error("A pending mastery question already exists.");
  const concept = session.blueprint.concepts.find(
    (entry) => entry.id === question.conceptId,
  );
  if (!concept || !session.conceptStates[question.conceptId]) {
    throw new Error(`Unknown question concept: ${question.conceptId}`);
  }
  const expectedRubric = new Map(
    concept.rubric.map((criterion) => [criterion.id, criterion]),
  );
  if (question.rubric.length !== concept.rubric.length) {
    throw new Error(
      "Question rubric does not match its validated concept rubric.",
    );
  }
  for (const criterion of question.rubric) {
    const expected = expectedRubric.get(criterion.id);
    if (
      !expected ||
      expected.maxScore !== criterion.maxScore ||
      expected.essential !== criterion.essential
    ) {
      throw new Error(
        `Question rubric criterion ${criterion.id} does not match the blueprint.`,
      );
    }
  }
  return { ...session, pendingQuestion: question, updatedAt: iso(clock) };
}
function normalizeGrade(question: MasteryQuestion, grade: MasteryGrade) {
  const gradesById = new Map<string, CriterionGrade>();
  for (const criterionGrade of grade.criterionGrades) {
    if (gradesById.has(criterionGrade.criterionId)) {
      throw new Error(
        `Duplicate criterion grade: ${criterionGrade.criterionId}.`,
      );
    }
    gradesById.set(criterionGrade.criterionId, criterionGrade);
  }
  let earned = 0;
  let possible = 0;
  let essentialPassed = true;
  for (const rubric of question.rubric) {
    const criterionGrade = gradesById.get(rubric.id);
    if (!criterionGrade)
      throw new Error(`Missing criterion grade: ${rubric.id}.`);
    const maxScore = rubric.maxScore;
    const score = Math.min(maxScore, Math.max(0, criterionGrade.score));
    earned += score;
    possible += maxScore;
    if (rubric.essential && score < maxScore * 0.5) essentialPassed = false;
    gradesById.delete(rubric.id);
  }
  if (gradesById.size > 0) {
    throw new Error(
      `Grade references unknown criterion ${gradesById.keys().next().value}.`,
    );
  }
  const normalized = possible > 0 ? earned / possible : 0;
  return {
    score: clamp01(normalized),
    passed: normalized >= 0.7 && essentialPassed,
  };
}
function successfulDelayedReviews(session: MasterySession, conceptId: string) {
  return session.attempts.filter(
    (attempt) =>
      attempt.question.conceptId === conceptId &&
      attempt.delayedReview &&
      attempt.normalizedScore >= 0.8,
  ).length;
}
function applyMasteryGrade(
  input: MasteryAnswerInput & {
    session: MasterySession;
    grade: MasteryGrade;
    clock: Clock;
    idFactory: IdFactory;
  },
): MasterySession {
  const question = input.session.pendingQuestion;
  if (!question)
    throw new Error("No pending question is available for grading.");
  const now = iso(input.clock);
  const normalized = normalizeGrade(question, input.grade);
  const learnerConfidence =
    input.learnerConfidence === undefined
      ? undefined
      : clamp01(input.learnerConfidence);
  const hintLevel = Math.max(0, Math.min(5, Math.floor(input.hintLevel ?? 0)));
  const majorMisconception = input.grade.misconceptions.some(
    (entry) => entry.severity === "major",
  );
  const delayedReview = input.delayedReview ?? false;
  const attempt = {
    id: input.idFactory.next("attempt"),
    question,
    answer: input.answer.trim(),
    ...(learnerConfidence !== undefined ? { learnerConfidence } : {}),
    grade: input.grade,
    normalizedScore: normalized.score,
    passed: normalized.passed,
    hintLevel,
    startedAt: input.startedAt ?? input.session.updatedAt,
    submittedAt: now,
    ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    delayedReview,
  };
  const newMisconceptions = input.grade.misconceptions.map((entry) => ({
    id: input.idFactory.next("misconception"),
    conceptId: question.conceptId,
    statement: entry.statement,
    severity: entry.severity,
    status: "open",
    evidence: entry.evidence,
    createdAt: now,
  }));
  const previousMisconceptions = input.session.misconceptions.map((entry) => {
    if (
      entry.conceptId !== question.conceptId ||
      !normalized.passed ||
      majorMisconception
    )
      return entry;
    if (entry.status === "open")
      return { ...entry, status: "repaired", repairedAt: now };
    if (entry.status === "repaired" && delayedReview)
      return { ...entry, status: "retested", retestedAt: now };
    return entry;
  });
  const previousState = input.session.conceptStates[question.conceptId];
  if (!previousState)
    throw new Error(`Missing concept state for ${question.conceptId}.`);
  const bestScore = Math.max(previousState.bestScore, normalized.score);
  const openMajorAfterGrade = [
    ...previousMisconceptions,
    ...newMisconceptions,
  ].some(
    (entry) =>
      entry.conceptId === question.conceptId &&
      entry.status === "open" &&
      entry.severity === "major",
  );
  const status =
    bestScore >= 0.8 && !openMajorAfterGrade ? "mastered" : "developing";
  const nextReviewAt = (0, reviewScheduler_1.scheduleNextReview)({
    submittedAt: now,
    normalizedScore: normalized.score,
    hintLevel,
    previousSuccessfulReviews: successfulDelayedReviews(
      input.session,
      question.conceptId,
    ),
    majorMisconception,
  });
  let next: MasterySession = {
    ...input.session,
    attempts: [...input.session.attempts, attempt],
    misconceptions: [...previousMisconceptions, ...newMisconceptions],
    conceptStates: {
      ...input.session.conceptStates,
      [question.conceptId]: {
        ...previousState,
        status,
        attemptCount: previousState.attemptCount + 1,
        bestScore,
        latestScore: normalized.score,
        lastAttemptAt: now,
        nextReviewAt,
      },
    },
    pendingQuestion: undefined,
    updatedAt: now,
  };
  const completion = calculateCompletionStatus(next);
  if (completion.complete) {
    next = { ...next, phase: "complete", completedAt: now, updatedAt: now };
  }
  return next;
}
function resolveMisconception(
  session: MasterySession,
  misconceptionId: string,
  status: string,
  clock: Clock,
) {
  const now = iso(clock);
  let found = false;
  const misconceptions = session.misconceptions.map((entry) => {
    if (entry.id !== misconceptionId) return entry;
    found = true;
    const validTransition =
      (entry.status === "open" && status === "repaired") ||
      (entry.status === "repaired" && status === "retested");
    if (!validTransition)
      throw new Error(
        `Invalid misconception transition: ${entry.status} -> ${status}`,
      );
    return {
      ...entry,
      status,
      ...(status === "repaired" ? { repairedAt: now } : { retestedAt: now }),
    };
  });
  if (!found) throw new Error(`Unknown misconception: ${misconceptionId}`);
  return { ...session, misconceptions, updatedAt: now };
}
function calculateMasteryMetrics(session: MasterySession) {
  const conceptsById = new Map(
    session.blueprint.concepts.map((concept) => [concept.id, concept]),
  );
  const totalWeight = session.blueprint.concepts.reduce(
    (sum, concept) => sum + conceptWeight(concept),
    0,
  );
  const testedWeight = session.blueprint.concepts.reduce((sum, concept) => {
    return (
      sum +
      (session.conceptStates[concept.id]?.attemptCount > 0
        ? conceptWeight(concept)
        : 0)
    );
  }, 0);
  let earned = 0;
  let possible = 0;
  const calibrationErrors = [];
  let retentionEarned = 0;
  let retentionPossible = 0;
  for (const attempt of session.attempts) {
    const concept = conceptsById.get(attempt.question.conceptId);
    const weight = concept ? conceptWeight(concept) : 1;
    earned += attempt.normalizedScore * weight;
    possible += weight;
    if (attempt.learnerConfidence !== undefined) {
      calibrationErrors.push(
        Math.abs(attempt.learnerConfidence - attempt.normalizedScore),
      );
    }
    if (attempt.delayedReview) {
      retentionEarned += attempt.normalizedScore;
      retentionPossible += 1;
    }
  }
  return {
    coverage: totalWeight > 0 ? testedWeight / totalWeight : 0,
    answerQuality: possible > 0 ? earned / possible : 0,
    calibration:
      calibrationErrors.length > 0
        ? 1 -
          calibrationErrors.reduce((sum, value) => sum + value, 0) /
            calibrationErrors.length
        : null,
    retention:
      retentionPossible > 0 ? retentionEarned / retentionPossible : null,
  };
}
function calculateCompletionStatus(session: MasterySession) {
  const metrics = calculateMasteryMetrics(session);
  const coreConcepts = session.blueprint.concepts.filter(
    (concept) => concept.importance === "core",
  );
  const coreMastered = coreConcepts.filter(
    (concept) => session.conceptStates[concept.id]?.status === "mastered",
  ).length;
  const coreMasteryRatio =
    coreConcepts.length > 0 ? coreMastered / coreConcepts.length : 1;
  const dimensions = new Set(
    session.blueprint.concepts.map((concept) => concept.dimension),
  );
  const coveredDimensions = new Set(
    session.attempts.map(
      (attempt) =>
        session.blueprint.concepts.find(
          (concept) => concept.id === attempt.question.conceptId,
        )?.dimension,
    ),
  );
  const allPresentDimensionsCovered = [...dimensions].every((dimension) =>
    coveredDimensions.has(dimension),
  );
  const advancedOrTransferPassed = session.attempts.some(
    (attempt) =>
      attempt.passed &&
      (attempt.question.difficulty === "advanced" ||
        attempt.question.mode === "transfer"),
  );
  const openMajor = openMajorMisconceptionCount(session);
  const reasons = [];
  if (metrics.coverage < 0.9)
    reasons.push("Core and supporting concept coverage is below 90%.");
  if (coreMasteryRatio < 0.9)
    reasons.push("Fewer than 90% of core concepts are mastered.");
  if (metrics.answerQuality < 0.8)
    reasons.push("Rubric-weighted answer quality is below 80%.");
  if (!allPresentDimensionsCovered)
    reasons.push("At least one blueprint dimension has not been tested.");
  if (!advancedOrTransferPassed)
    reasons.push("No advanced or transfer question has been passed.");
  if (openMajor > 0) reasons.push("A major misconception is still open.");
  return {
    complete: reasons.length === 0,
    reasons,
    metrics,
    openMajorMisconceptions: openMajor,
    advancedOrTransferPassed,
  };
}

export {
  applyMasteryGrade,
  calculateCompletionStatus,
  calculateMasteryMetrics,
  createMasterySession,
  resolveMisconception,
  selectNextConcept,
  setPendingQuestion,
};
