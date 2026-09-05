import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
import { enumValue, optionalUnitInterval } from "../parserValidation";
import type {
  CrossPaperAttempt,
  CrossPaperConcept,
  CrossPaperParseScope,
  CrossPaperQuestion,
} from "./types";
const MODES = new Set([
  "compare",
  "synthesis",
  "conflict",
  "transfer",
  "timeline",
]);
const DIFFICULTIES = new Set(["intermediate", "advanced"]);
function strings(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && !!entry.trim())
        .map((entry) => entry.trim())
    : [];
}
function uniqueStrings(value: unknown) {
  return [...new Set(strings(value))];
}
function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function parseCrossPaperQuestionResponse(
  params: CrossPaperParseScope & {
    concept?: CrossPaperConcept;
    allowedPaperKeys?: Set<string>;
  },
): CrossPaperQuestion {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const mode = enumValue(root.mode, "cross-paper question mode", MODES);
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
    const id = (0, json_1.readString)(object.id, `rubric[${index}].id`);
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
    const maxScore = (0, json_1.readNumber)(
      object.maxScore,
      `rubric[${index}].maxScore`,
      { min: 1, max: 20 },
    );
    return {
      id,
      description: (0, json_1.readString)(
        object.description,
        `rubric[${index}].description`,
      ),
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
  const evidence: Record<string, types_1.EvidenceReference[]> = {};
  if (
    root.evidence &&
    typeof root.evidence === "object" &&
    !Array.isArray(root.evidence)
  ) {
    const rawEvidence = root.evidence as Record<string, unknown>;
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
    prompt: (0, json_1.readString)(root.prompt, "prompt"),
    paperKeys,
    difficulty: enumValue(root.difficulty, "difficulty", DIFFICULTIES),
    createdAt: now,
    rubric,
    criteria: rubric,
    evidence,
  };
}
function parseCrossPaperGradeResponse(
  params: CrossPaperParseScope & {
    question: {
      id: string;
      rubric: { id: string; maxScore: number; requiredPaperKeys?: string[] }[];
    };
    answer?: string;
    learnerConfidence?: number;
  },
): CrossPaperAttempt {
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
  const supplied = new Map<
    string,
    Record<string, unknown> & { score: number }
  >();
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
    const object = supplied.get(criterion.id)!;
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
    learnerConfidence: optionalUnitInterval(
      params.learnerConfidence,
      "learnerConfidence",
    ),
    grades,
    feedback: (0, json_1.readString)(root.feedback, "feedback"),
    misconceptions: strings(root.misconceptions),
    graderConfidence: optionalUnitInterval(
      root.graderConfidence,
      "graderConfidence",
    ),
    createdAt: now,
  };
}

export { parseCrossPaperGradeResponse, parseCrossPaperQuestionResponse };
