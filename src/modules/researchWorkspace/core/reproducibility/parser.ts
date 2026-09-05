import * as json_1 from "../comprehensionCheck/v2/json";
import type { PaperResponseInput } from "../contracts";
import * as types_1 from "../evidence/types";
import { enumValue, optionalUnitInterval } from "../parserValidation";
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
function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}
function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && !!entry.trim())
        .map((entry) => entry.trim())
    : [];
}
function normalizedKind(value: unknown) {
  return enumValue(value, "reproducibility artifact kind", KINDS);
}
function normalizedAvailability(value: unknown) {
  return enumValue(value, "reproducibility availability", AVAILABILITY);
}
function parseReproducibilityResponse(params: PaperResponseInput) {
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
      const id = (0, json_1.readString)(object.id, `artifacts[${index}].id`);
      const label = (0, json_1.readString)(
        object.label,
        `artifacts[${index}].label`,
      );
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
        ...(optionalUnitInterval(
          object.confidence,
          `artifacts[${index}].confidence`,
        ) !== undefined
          ? {
              confidence: optionalUnitInterval(
                object.confidence,
                `artifacts[${index}].confidence`,
              ),
            }
          : {}),
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
      const severity = enumValue(
        object.severity,
        `blockers[${index}].severity`,
        SEVERITIES,
      );
      return {
        id: (0, json_1.readString)(object.id, `blockers[${index}].id`),
        severity,
        description: (0, json_1.readString)(
          object.description ?? object.title,
          `blockers[${index}].description`,
        ),
        mitigation: (0, json_1.readString)(
          object.mitigation,
          `blockers[${index}].mitigation`,
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
    summary: (0, json_1.readString)(root.summary, "summary"),
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
  parseReproducibilityResponse as parseReproducibilityAuditResponse,
  parseReproducibilityResponse,
};
