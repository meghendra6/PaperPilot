// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as types_1 from "../../evidence/types";
import * as json_1 from "./json";
const DIMENSION_VALUES = [
  "contribution",
  "mechanism",
  "assumption",
  "evidence",
  "limitation",
  "transfer",
];
const DIMENSIONS = new Set(DIMENSION_VALUES);
const IMPORTANCE = new Set(["core", "supporting"]);
const DIFFICULTIES = new Set(["foundational", "intermediate", "advanced"]);
const MODES = new Set([
  "recall",
  "teach_back",
  "figure_explanation",
  "mechanism_trace",
  "counterfactual",
  "transfer",
  "comparison",
]);
const SEVERITIES = new Set(["minor", "major"]);
function enumValue(value, fieldName, allowed) {
  const normalized = (0, json_1.readString)(value, fieldName);
  if (!allowed.has(normalized)) {
    throw new Error(`${fieldName} has unsupported value: ${normalized}`);
  }
  return normalized;
}
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(json_1.readOptionalString)
    .filter((entry) => entry !== undefined);
}
function uniqueIds(values, fieldName) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.id))
      throw new Error(`${fieldName} contains duplicate ID: ${value.id}`);
    seen.add(value.id);
  }
}
function evidenceOptions(options) {
  const expectedAttachmentKey = options.expectedAttachmentKey?.trim();
  return {
    ...(expectedAttachmentKey
      ? { allowedAttachmentKeys: new Set([expectedAttachmentKey]) }
      : {}),
    ...(expectedAttachmentKey && options.pageCount !== undefined
      ? {
          pageCountByAttachmentKey: new Map([
            [expectedAttachmentKey, Math.max(0, Math.floor(options.pageCount))],
          ]),
        }
      : {}),
  };
}
function expectedClaim(value, index, normalization) {
  const object = (0, json_1.readObject)(value, `expectedClaims[${index}]`);
  return {
    id: (0, json_1.readString)(object.id, `expectedClaims[${index}].id`),
    text: (0, json_1.readString)(object.text, `expectedClaims[${index}].text`),
    required: (0, json_1.readBoolean)(object.required, true),
    evidence: (0, types_1.normalizeEvidenceReferences)(
      object.evidence,
      normalization,
    ),
  };
}
function rubricCriterion(value, index, normalization) {
  const object = (0, json_1.readObject)(value, `rubric[${index}]`);
  return {
    id: (0, json_1.readString)(object.id, `rubric[${index}].id`),
    description: (0, json_1.readString)(
      object.description,
      `rubric[${index}].description`,
    ),
    maxScore: (0, json_1.readNumber)(
      object.maxScore,
      `rubric[${index}].maxScore`,
      { min: 0.1 },
    ),
    essential: (0, json_1.readBoolean)(object.essential, false),
    evidence: (0, types_1.normalizeEvidenceReferences)(
      object.evidence,
      normalization,
    ),
  };
}
function masteryConcept(value, index, normalization) {
  const object = (0, json_1.readObject)(value, `concepts[${index}]`);
  const expectedClaims = (0, json_1.readArray)(
    object.expectedClaims ?? [],
    `concepts[${index}].expectedClaims`,
  ).map((entry, claimIndex) => expectedClaim(entry, claimIndex, normalization));
  const rubric = (0, json_1.readArray)(
    object.rubric ?? [],
    `concepts[${index}].rubric`,
  ).map((entry, criterionIndex) =>
    rubricCriterion(entry, criterionIndex, normalization),
  );
  if (rubric.length === 0) {
    throw new Error(
      `concepts[${index}].rubric must contain at least one criterion.`,
    );
  }
  uniqueIds(expectedClaims, `concepts[${index}].expectedClaims`);
  uniqueIds(rubric, `concepts[${index}].rubric`);
  return {
    id: (0, json_1.readString)(object.id, `concepts[${index}].id`),
    name: (0, json_1.readString)(object.name, `concepts[${index}].name`),
    dimension: enumValue(
      object.dimension,
      `concepts[${index}].dimension`,
      DIMENSIONS,
    ),
    importance: enumValue(
      object.importance,
      `concepts[${index}].importance`,
      IMPORTANCE,
    ),
    learningObjective: (0, json_1.readString)(
      object.learningObjective,
      `concepts[${index}].learningObjective`,
    ),
    prerequisites: stringArray(object.prerequisites),
    expectedClaims,
    evidence: (0, types_1.normalizeEvidenceReferences)(
      object.evidence,
      normalization,
    ),
    rubric,
  };
}
function assertAcyclic(concepts) {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(Math.max(0, cycleStart)), id].join(" -> ");
      throw new Error(
        `Mastery blueprint contains a prerequisite cycle: ${cycle}`,
      );
    }
    visiting.add(id);
    const concept = byId.get(id);
    for (const prerequisite of concept?.prerequisites ?? []) {
      visit(prerequisite, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const concept of concepts) visit(concept.id, []);
}
function validateBlueprint(blueprint, options) {
  if (blueprint.concepts.length === 0)
    throw new Error("A mastery blueprint needs concepts.");
  if (
    options.maxConcepts !== undefined &&
    blueprint.concepts.length > options.maxConcepts
  ) {
    throw new Error(
      `Mastery blueprint has ${blueprint.concepts.length} concepts; maximum is ${options.maxConcepts}.`,
    );
  }
  uniqueIds(blueprint.concepts, "blueprint.concepts");
  const ids = new Set(blueprint.concepts.map((concept) => concept.id));
  for (const concept of blueprint.concepts) {
    for (const prerequisite of concept.prerequisites) {
      if (!ids.has(prerequisite)) {
        throw new Error(
          `Concept ${concept.id} references unknown prerequisite ${prerequisite}.`,
        );
      }
      if (prerequisite === concept.id) {
        throw new Error(`Concept ${concept.id} cannot depend on itself.`);
      }
    }
  }
  assertAcyclic(blueprint.concepts);
  if (options.requireAllDimensions) {
    const present = new Set(
      blueprint.concepts.map((concept) => concept.dimension),
    );
    const missing = DIMENSION_VALUES.filter(
      (dimension) => !present.has(dimension),
    );
    if (missing.length > 0) {
      throw new Error(
        `Mastery blueprint is missing dimensions: ${missing.join(", ")}.`,
      );
    }
  }
  return blueprint;
}
function parseMasteryBlueprintResponse(text, options = {}) {
  const root = (0, json_1.extractLastJsonObject)(text);
  const blueprintObject = (0, json_1.readObject)(
    root.blueprint ?? root,
    "blueprint",
  );
  const normalization = evidenceOptions(options);
  const concepts = (0, json_1.readArray)(
    blueprintObject.concepts,
    "blueprint.concepts",
  ).map((entry, index) => masteryConcept(entry, index, normalization));
  const paperTitle = (0, json_1.readOptionalString)(blueprintObject.paperTitle);
  return validateBlueprint(
    {
      ...(paperTitle ? { paperTitle } : {}),
      concepts,
    },
    options,
  );
}
/**
 * The question generator may choose wording, difficulty, and mode only. Hidden
 * expected claims, rubric, and evidence always come from the validated blueprint.
 */
function parseMasteryQuestionResponse(text, fallback, generatedQuestionId) {
  const root = (0, json_1.extractLastJsonObject)(text);
  const object = (0, json_1.readObject)(root.question ?? root, "question");
  const conceptId =
    (0, json_1.readOptionalString)(object.conceptId) ?? fallback.id;
  if (conceptId !== fallback.id) {
    throw new Error(
      `Question concept mismatch: expected ${fallback.id}, received ${conceptId}.`,
    );
  }
  return {
    id:
      generatedQuestionId?.trim() ||
      (0, json_1.readString)(object.id, "question.id"),
    conceptId,
    difficulty: enumValue(
      object.difficulty,
      "question.difficulty",
      DIFFICULTIES,
    ),
    mode: enumValue(object.mode, "question.mode", MODES),
    prompt: (0, json_1.readString)(object.prompt, "question.prompt"),
    expectedClaims: fallback.expectedClaims,
    rubric: fallback.rubric,
    evidence: fallback.evidence,
  };
}
function evidenceKeysFromQuestion(question) {
  const keys = new Set();
  const add = (references) => {
    for (const reference of references) keys.add(reference.attachmentKey);
  };
  add(question.evidence);
  for (const claim of question.expectedClaims) add(claim.evidence);
  for (const criterion of question.rubric) add(criterion.evidence);
  return keys;
}
function criterionGrade(value, index, rubricById, normalization) {
  const object = (0, json_1.readObject)(value, `criterionGrades[${index}]`);
  const criterionId = (0, json_1.readString)(
    object.criterionId,
    `criterionGrades[${index}].criterionId`,
  );
  const rubric = rubricById.get(criterionId);
  if (!rubric) throw new Error(`Unknown criterion grade: ${criterionId}`);
  return {
    criterionId,
    score: (0, json_1.readNumber)(
      object.score,
      `criterionGrades[${index}].score`,
      {
        min: 0,
        max: rubric.maxScore,
      },
    ),
    // The trusted blueprint owns the maximum; never trust an echoed model value.
    maxScore: rubric.maxScore,
    feedback: (0, json_1.readString)(
      object.feedback,
      `criterionGrades[${index}].feedback`,
    ),
    evidence: (0, types_1.normalizeEvidenceReferences)(
      object.evidence,
      normalization,
    ),
  };
}
function parseMasteryGradeResponse(text, question) {
  const root = (0, json_1.extractLastJsonObject)(text);
  const object = (0, json_1.readObject)(root.grade ?? root, "grade");
  const rubricById = new Map(
    question.rubric.map((criterion) => [criterion.id, criterion]),
  );
  const allowedAttachmentKeys = evidenceKeysFromQuestion(question);
  const normalization =
    allowedAttachmentKeys.size > 0 ? { allowedAttachmentKeys } : {};
  const criterionGrades = (0, json_1.readArray)(
    object.criterionGrades,
    "grade.criterionGrades",
  ).map((entry, index) =>
    criterionGrade(entry, index, rubricById, normalization),
  );
  uniqueIds(
    criterionGrades.map((grade) => ({ id: grade.criterionId })),
    "grade.criterionGrades",
  );
  const receivedIds = new Set(
    criterionGrades.map((criterion) => criterion.criterionId),
  );
  for (const id of rubricById.keys()) {
    if (!receivedIds.has(id)) throw new Error(`Missing criterion grade: ${id}`);
  }
  const misconceptions = (0, json_1.readArray)(
    object.misconceptions ?? [],
    "grade.misconceptions",
  ).map((value, index) => {
    const misconception = (0, json_1.readObject)(
      value,
      `misconceptions[${index}]`,
    );
    return {
      statement: (0, json_1.readString)(
        misconception.statement,
        `misconceptions[${index}].statement`,
      ),
      severity: enumValue(
        misconception.severity,
        `misconceptions[${index}].severity`,
        SEVERITIES,
      ),
      evidence: (0, types_1.normalizeEvidenceReferences)(
        misconception.evidence,
        normalization,
      ),
    };
  });
  return {
    criterionGrades,
    misconceptions,
    overallFeedback: (0, json_1.readString)(
      object.overallFeedback,
      "grade.overallFeedback",
    ),
    explanation: (0, json_1.readString)(
      object.explanation,
      "grade.explanation",
    ),
    graderConfidence: (0, json_1.readNumber)(
      object.graderConfidence,
      "grade.graderConfidence",
      {
        min: 0,
        max: 1,
      },
    ),
  };
}

export {
  parseMasteryBlueprintResponse,
  parseMasteryQuestionResponse,
  parseMasteryGradeResponse,
};
