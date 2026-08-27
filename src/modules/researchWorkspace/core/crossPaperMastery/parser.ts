// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
const MODES = new Set([
  "compare",
  "synthesis",
  "conflict",
  "transfer",
  "timeline",
]);
function strings(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && !!entry.trim())
        .map((entry) => entry.trim())
    : [];
}
function uniqueStrings(value) {
  return [...new Set(strings(value))];
}
function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function parseCrossPaperQuestionResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const mode = text(root.mode, "compare");
  if (!MODES.has(mode))
    throw new Error(`Invalid cross-paper question mode ${mode}`);
  const paperKeys = uniqueStrings(root.paperKeys);
  if (paperKeys.length < 2)
    throw new Error(
      "A cross-paper question must reference at least two papers.",
    );
  const allowedPaperKeys =
    params.allowedPaperKeys ?? new Set(params.concept?.paperKeys ?? paperKeys);
  for (const paperKey of paperKeys)
    if (!allowedPaperKeys.has(paperKey))
      throw new Error(`Unknown paper ${paperKey}`);
  const attachmentKeys =
    params.allowedAttachmentKeys ?? new Set(params.allowedAttachments ?? []);
  const rawRubric = Array.isArray(root.rubric)
    ? root.rubric
    : Array.isArray(root.criteria)
      ? root.criteria
      : [];
  if (!rawRubric.length)
    throw new Error("Cross-paper question requires a hidden rubric.");
  const seen = new Set();
  const rubric = rawRubric.map((entry, index) => {
    const object = (0, json_1.readObject)(entry, `rubric[${index}]`);
    const id = text(object.id, `criterion-${index + 1}`);
    if (seen.has(id)) throw new Error(`Duplicate rubric criterion ${id}`);
    seen.add(id);
    const requiredPaperKeys = uniqueStrings(
      object.requiredPaperKeys ?? object.paperKeys,
    );
    if (!requiredPaperKeys.length)
      throw new Error(`Rubric criterion ${id} must reference papers.`);
    requiredPaperKeys.forEach((key) => {
      if (!allowedPaperKeys.has(key))
        throw new Error(`Unknown rubric paper ${key}`);
    });
    const expectedClaims = strings(
      object.expectedClaims ?? object.requiredClaims,
    );
    const maxScore = Math.max(1, Math.min(20, Number(object.maxScore) || 1));
    return {
      id,
      description: text(object.description, "Unspecified criterion"),
      maxScore,
      requiredPaperKeys,
      expectedClaims,
      evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
        allowedAttachmentKeys: attachmentKeys.size ? attachmentKeys : undefined,
      }),
      paperKeys: requiredPaperKeys,
      requiredClaims: expectedClaims,
    };
  });
  const evidence = {};
  if (
    root.evidence &&
    typeof root.evidence === "object" &&
    !Array.isArray(root.evidence)
  ) {
    const rawEvidence = root.evidence;
    for (const paperKey of paperKeys)
      evidence[paperKey] = (0, types_1.normalizeEvidenceReferences)(
        rawEvidence[paperKey],
        {
          allowedAttachmentKeys: attachmentKeys.size
            ? attachmentKeys
            : undefined,
        },
      );
  }
  const now = params.now ?? new Date().toISOString();
  return {
    id:
      params.id ??
      text(root.id, `cross-question-${now.replace(/[^0-9]/g, "")}`),
    conceptId: params.concept?.id ?? text(root.conceptId, "general"),
    mode,
    prompt: text(root.prompt, "Compare the selected papers."),
    paperKeys,
    difficulty:
      root.difficulty === "intermediate" ? "intermediate" : "advanced",
    createdAt: now,
    rubric,
    criteria: rubric,
    evidence,
  };
}
function parseCrossPaperGradeResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const rawGrades = Array.isArray(root.grades)
    ? root.grades
    : Array.isArray(root.criterionScores)
      ? root.criterionScores
      : null;
  if (!rawGrades)
    throw new Error("Cross-paper grade must include criterion scores.");
  const allowedAttachmentKeys =
    params.allowedAttachmentKeys ?? new Set(params.allowedAttachments ?? []);
  const rubricById = new Map(
    params.question.rubric.map((criterion) => [criterion.id, criterion]),
  );
  const seen = new Set();
  const supplied = new Map();
  for (const [index, entry] of rawGrades.entries()) {
    const object = (0, json_1.readObject)(entry, `grades[${index}]`);
    const criterionId = text(object.criterionId);
    if (!rubricById.has(criterionId) || seen.has(criterionId))
      throw new Error(`Unknown or duplicate criterion ${criterionId}`);
    const score = Number(object.score);
    if (!Number.isFinite(score))
      throw new Error(`Criterion ${criterionId} score must be finite.`);
    seen.add(criterionId);
    supplied.set(criterionId, { ...object, score });
  }
  for (const criterionId of rubricById.keys())
    if (!seen.has(criterionId))
      throw new Error(`Missing criterion ${criterionId}`);
  const grades = params.question.rubric.map((criterion) => {
    const object = supplied.get(criterion.id);
    return {
      criterionId: criterion.id,
      score: Math.max(0, Math.min(criterion.maxScore, object.score)),
      maxScore: criterion.maxScore,
      feedback: text(object?.feedback),
      evidence: (0, types_1.normalizeEvidenceReferences)(object?.evidence, {
        allowedAttachmentKeys: allowedAttachmentKeys.size
          ? allowedAttachmentKeys
          : undefined,
      }),
    };
  });
  const now = params.now ?? new Date().toISOString();
  return {
    id:
      params.id ?? text(root.id, `cross-attempt-${now.replace(/[^0-9]/g, "")}`),
    questionId: params.question.id,
    answer: params.answer ?? text(root.answer),
    learnerConfidence: Math.max(
      0,
      Math.min(
        1,
        Number(params.learnerConfidence ?? root.learnerConfidence) || 0,
      ),
    ),
    grades,
    misconceptions: strings(root.misconceptions),
    graderConfidence: Math.max(
      0,
      Math.min(1, Number(root.graderConfidence) || 0),
    ),
    createdAt: now,
  };
}

export { parseCrossPaperQuestionResponse, parseCrossPaperGradeResponse };
