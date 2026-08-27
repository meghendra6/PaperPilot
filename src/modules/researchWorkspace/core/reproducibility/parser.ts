// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
const KINDS = new Set([
  "code",
  "commit",
  "dataset",
  "data",
  "model",
  "environment",
  "hardware",
  "training_config",
  "training",
  "inference_config",
  "inference",
  "evaluation_command",
  "evaluation",
  "random_seeds",
  "license",
  "results",
  "other",
]);
const AVAILABILITY = new Set([
  "available",
  "partial",
  "missing",
  "not_applicable",
  "unclear",
]);
const SEVERITIES = new Set(["minor", "major", "critical"]);
function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}
function stringArray(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && !!entry.trim())
        .map((entry) => entry.trim())
    : [];
}
function normalizedKind(value) {
  const candidate = text(value, "other");
  if (!KINDS.has(candidate))
    throw new Error(`Unsupported reproducibility artifact kind: ${candidate}`);
  return candidate;
}
function normalizedAvailability(value) {
  const candidate = text(value, "unclear");
  if (!AVAILABILITY.has(candidate))
    throw new Error(`Unsupported reproducibility availability: ${candidate}`);
  return candidate;
}
function clamp01(value) {
  const number =
    typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}
function parseReproducibilityResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const allowedAttachmentKeys = new Set([params.attachmentKey]);
  const now = params.now ?? new Date().toISOString();
  const artifacts = (0, json_1.readArray)(root.artifacts, "artifacts").map(
    (entry, index) => {
      const object = (0, json_1.readObject)(entry, `artifacts[${index}]`);
      const kind = normalizedKind(object.kind ?? object.category);
      const availability = normalizedAvailability(
        object.availability ?? object.status,
      );
      const id = text(object.id, `${kind}-${index + 1}`);
      const label = text(object.label, kind.replace(/_/g, " "));
      const evidence = (0, types_1.normalizeEvidenceReferences)(
        object.evidence,
        { allowedAttachmentKeys },
      );
      const blocker = object.blocker === true || availability === "missing";
      return {
        id,
        kind,
        category: kind,
        label,
        availability,
        status: availability,
        blocker,
        ...((0, json_1.readOptionalString)(object.value)
          ? { value: (0, json_1.readOptionalString)(object.value) }
          : {}),
        ...((0, json_1.readOptionalString)(object.url)
          ? { url: (0, json_1.readOptionalString)(object.url) }
          : {}),
        ...((0, json_1.readOptionalString)(object.version)
          ? { version: (0, json_1.readOptionalString)(object.version) }
          : {}),
        ...((0, json_1.readOptionalString)(object.notes)
          ? { notes: (0, json_1.readOptionalString)(object.notes) }
          : {}),
        evidence,
        confidence: clamp01(
          object.confidence ?? (evidence.length ? 0.7 : 0.35),
        ),
      };
    },
  );
  const steps = (Array.isArray(root.steps) ? root.steps : [])
    .map((entry, index) => {
      const object = (0, json_1.readObject)(entry, `steps[${index}]`);
      return {
        order: Number.isFinite(Number(object.order))
          ? Math.max(1, Math.floor(Number(object.order)))
          : index + 1,
        title: text(object.title, `Step ${index + 1}`),
        inputs: stringArray(object.inputs),
        outputs: stringArray(object.outputs),
        assumptions: stringArray(object.assumptions),
        unresolved: stringArray(object.unresolved),
        evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
          allowedAttachmentKeys,
        }),
      };
    })
    .sort((left, right) => left.order - right.order);
  const blockers = (0, json_1.readArray)(root.blockers, "blockers").map(
    (entry, index) => {
      if (typeof entry === "string") {
        return {
          id: `blocker-${index + 1}`,
          severity: "major",
          description: entry.trim(),
          mitigation:
            "Resolve or document this blocker before claiming reproduction.",
          evidence: [],
        };
      }
      const object = (0, json_1.readObject)(entry, `blockers[${index}]`);
      const severityText = text(object.severity, "major");
      if (!SEVERITIES.has(severityText))
        throw new Error(`Unsupported blocker severity: ${severityText}`);
      const severity = severityText;
      return {
        id: text(object.id, `blocker-${index + 1}`),
        severity,
        description: text(
          object.description,
          text(object.title, "Unspecified blocker"),
        ),
        mitigation: text(
          object.mitigation,
          "Clarify the missing information or use a documented substitute.",
        ),
        evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
          allowedAttachmentKeys,
        }),
      };
    },
  );
  for (const artifact of artifacts) {
    if (!artifact.blocker) continue;
    if (
      blockers.some((blocker) =>
        blocker.description
          .toLowerCase()
          .includes(artifact.label.toLowerCase()),
      )
    )
      continue;
    blockers.push({
      id: `artifact-blocker-${artifact.id}`,
      severity: artifact.availability === "missing" ? "major" : "minor",
      description: `${artifact.label} is ${artifact.availability.replace(/_/g, " ")}.`,
      mitigation:
        artifact.notes ||
        `Provide or document ${artifact.label.toLowerCase()}.`,
      evidence: artifact.evidence,
    });
  }
  const minimumViableReproduction = stringArray(
    root.minimumViableReproduction ?? root.minimalReproductionSteps,
  );
  const verificationChecks = stringArray(
    root.verificationChecks ?? root.verificationCommands,
  );
  const effortText = text(root.estimatedEffort, "unknown");
  const estimatedEffort =
    effortText === "low" || effortText === "medium" || effortText === "high"
      ? effortText
      : "unknown";
  return {
    schemaVersion: 2,
    id: text(root.id, `repro-${params.paperKey}-${now.replace(/[^0-9]/g, "")}`),
    paperKey: params.paperKey,
    attachmentKey: params.attachmentKey,
    summary: text(root.summary, "No reproducibility summary was returned."),
    artifacts,
    steps,
    blockers,
    estimatedEffort,
    minimumViableReproduction,
    verificationChecks,
    minimalReproductionSteps: minimumViableReproduction,
    verificationCommands: verificationChecks,
    createdAt: now,
  };
}
/** Public name used by the Research Workspace UI. */

export {
  parseReproducibilityResponse,
  parseReproducibilityResponse as parseReproducibilityAuditResponse,
};
