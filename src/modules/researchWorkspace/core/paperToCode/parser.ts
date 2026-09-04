// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
import { enumValue } from "../parserValidation";
const IMPACTS = new Set(["low", "medium", "high", "unknown"]);
function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}
function strings(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && !!entry.trim())
        .map((entry) => entry.trim())
    : [];
}
function asImpact(value) {
  return enumValue(value, "ambiguity risk", IMPACTS);
}
function parsePaperToCodeResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const allowedAttachmentKeys = new Set([params.attachmentKey]);
  const now = params.now ?? new Date().toISOString();
  const rawTrace = Array.isArray(root.trace)
    ? root.trace
    : Array.isArray(root.tensorTrace)
      ? root.tensorTrace
      : null;
  if (!rawTrace)
    throw new Error("Paper-to-Code output must include a trace array.");
  const trace = rawTrace
    .map((entry, index) => {
      const object = (0, json_1.readObject)(entry, `trace[${index}]`);
      const inputShapes = strings(object.inputShapes);
      const outputShapes = strings(object.outputShapes);
      const legacyInput = (0, json_1.readOptionalString)(object.inputShape);
      const legacyOutput = (0, json_1.readOptionalString)(object.outputShape);
      return {
        order: Number.isFinite(Number(object.order))
          ? Math.max(1, Math.floor(Number(object.order)))
          : index + 1,
        name: (0, json_1.readString)(
          object.name ?? object.stage,
          `trace[${index}].name`,
        ),
        operation: (0, json_1.readString)(
          object.operation,
          `trace[${index}].operation`,
        ),
        inputShapes: inputShapes.length
          ? inputShapes
          : legacyInput
            ? [legacyInput]
            : [],
        outputShapes: outputShapes.length
          ? outputShapes
          : legacyOutput
            ? [legacyOutput]
            : [],
        stateReads: strings(object.stateReads),
        stateWrites: strings(object.stateWrites ?? object.stateChanges),
        memoryOrCommunication: strings(
          object.memoryOrCommunication ?? object.memoryAccess,
        ),
        invariants: strings(object.invariants),
        ambiguity: strings(object.ambiguity),
        evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
          allowedAttachmentKeys,
        }),
      };
    })
    .sort((left, right) => left.order - right.order);
  const invariants = (0, json_1.readArray)(root.invariants, "invariants").map(
    (entry, index) => {
      if (typeof entry === "string") {
        return {
          id: `inv-${index + 1}`,
          statement: entry.trim(),
          consequence: "Implementation must preserve this invariant.",
          evidence: [],
        };
      }
      const object = (0, json_1.readObject)(entry, `invariants[${index}]`);
      return {
        id: text(object.id, `inv-${index + 1}`),
        statement: (0, json_1.readString)(
          object.statement,
          `invariants[${index}].statement`,
        ),
        consequence: text(
          object.consequence,
          "Violation changes correctness or semantics.",
        ),
        evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
          allowedAttachmentKeys,
        }),
      };
    },
  );
  const rawComplexity = (0, json_1.readObject)(root.complexity, "complexity");
  const compute = text(
    rawComplexity.compute,
    (0, json_1.readString)(rawComplexity.time, "complexity.time"),
  );
  const complexity = {
    compute,
    time: compute,
    memory: (0, json_1.readString)(rawComplexity.memory, "complexity.memory"),
    ...((0, json_1.readOptionalString)(rawComplexity.communication)
      ? {
          communication: (0, json_1.readOptionalString)(
            rawComplexity.communication,
          ),
        }
      : {}),
    ...((0, json_1.readOptionalString)(rawComplexity.bottleneck)
      ? { bottleneck: (0, json_1.readOptionalString)(rawComplexity.bottleneck) }
      : {}),
    assumptions: strings(rawComplexity.assumptions),
    evidence: (0, types_1.normalizeEvidenceReferences)(rawComplexity.evidence, {
      allowedAttachmentKeys,
    }),
  };
  const ambiguities = (0, json_1.readArray)(
    root.ambiguities,
    "ambiguities",
  ).map((entry, index) => {
    const object = (0, json_1.readObject)(entry, `ambiguities[${index}]`);
    const impact = asImpact(object.impact ?? object.risk);
    const proposedExperiment = text(
      object.proposedExperiment,
      (0, json_1.readString)(
        object.suggestedResolution,
        `ambiguities[${index}].suggestedResolution`,
      ),
    );
    return {
      id: text(object.id, `ambiguity-${index + 1}`),
      question: (0, json_1.readString)(
        object.question,
        `ambiguities[${index}].question`,
      ),
      impact,
      likelyChoices: strings(object.likelyChoices),
      proposedExperiment,
      evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
        allowedAttachmentKeys,
      }),
      risk: impact,
      suggestedResolution: proposedExperiment,
    };
  });
  const rawTests = Array.isArray(root.tests)
    ? root.tests
    : Array.isArray(root.validationTests)
      ? root.validationTests
      : null;
  if (!rawTests)
    throw new Error("Paper-to-Code output must include validation tests.");
  const tests = rawTests.map((entry, index) => {
    if (typeof entry === "string")
      return {
        name: `test-${index + 1}`,
        purpose: entry.trim(),
        setup: "",
        expected: "",
      };
    const object = (0, json_1.readObject)(entry, `tests[${index}]`);
    return {
      name: text(object.name, `test-${index + 1}`),
      purpose: text(object.purpose, "Validate paper-to-code behavior"),
      setup: text(object.setup),
      expected: text(object.expected),
    };
  });
  const paperCodeDivergences = (0, json_1.readArray)(
    root.paperCodeDivergences,
    "paperCodeDivergences",
  ).map((entry, index) => {
    const object = (0, json_1.readObject)(
      entry,
      `paperCodeDivergences[${index}]`,
    );
    return {
      area: (0, json_1.readString)(
        object.area,
        `paperCodeDivergences[${index}].area`,
      ),
      paperStatement: (0, json_1.readString)(
        object.paperStatement,
        `paperCodeDivergences[${index}].paperStatement`,
      ),
      codeBehavior: (0, json_1.readString)(
        object.codeBehavior,
        `paperCodeDivergences[${index}].codeBehavior`,
      ),
      impact: (0, json_1.readString)(
        object.impact,
        `paperCodeDivergences[${index}].impact`,
      ),
      evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
        allowedAttachmentKeys,
      }),
    };
  });
  const rawMinimalReproduction =
    root.minimalReproduction ?? root.implementationChecklist;
  if (!Array.isArray(rawMinimalReproduction))
    throw new Error(
      "Paper-to-Code output must include an implementation checklist.",
    );
  const minimalReproduction = strings(rawMinimalReproduction);
  const summary = (0, json_1.readString)(root.summary, "summary");
  const objective = (0, json_1.readString)(root.objective, "objective");
  const tensorTrace = trace.map((step, index) => ({
    id: `trace-${index + 1}`,
    stage: step.name,
    inputShape: step.inputShapes.join(", "),
    outputShape: step.outputShapes.join(", "),
    operation: step.operation,
    stateChanges: [
      ...step.stateReads.map((value) => `read: ${value}`),
      ...step.stateWrites.map((value) => `write: ${value}`),
    ],
    memoryAccess: step.memoryOrCommunication,
    evidence: step.evidence,
  }));
  return {
    schemaVersion: 2,
    id: text(
      root.id,
      `paper-to-code-${params.paperKey}-${now.replace(/[^0-9]/g, "")}`,
    ),
    paperKey: params.paperKey,
    attachmentKey: params.attachmentKey,
    objective,
    inputs: (0, json_1.readArray)(root.inputs, "inputs").map((entry, index) =>
      (0, json_1.readString)(entry, `inputs[${index}]`),
    ),
    outputs: (0, json_1.readArray)(root.outputs, "outputs").map(
      (entry, index) => (0, json_1.readString)(entry, `outputs[${index}]`),
    ),
    summary,
    pseudocode: (0, json_1.readString)(root.pseudocode, "pseudocode"),
    trace,
    tensorTrace,
    invariants,
    complexity,
    ambiguities,
    minimalReproduction,
    tests,
    paperCodeDivergences,
    implementationChecklist: minimalReproduction,
    validationTests: tests.map((test) => `${test.name}: ${test.purpose}`),
    createdAt: now,
  };
}

export { parsePaperToCodeResponse };
