// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as json_1 from "../comprehensionCheck/v2/json";
import * as types_1 from "../evidence/types";
import { enumValue, optionalUnitInterval } from "../parserValidation";
const STANCES = new Set([
  "supporting",
  "contrasting",
  "methodological",
  "background",
  "uncertain",
  // Read compatibility for artifacts written before the canonical taxonomy.
  "mentioning",
  "unclear",
]);
function parse(response, contexts, allowedAttachments) {
  const root = (0, json_1.extractLastJsonObject)(response);
  const contextIds = new Set();
  for (const context of contexts) {
    if (!context?.id || contextIds.has(context.id))
      throw new Error(
        `Missing or duplicate citation context ${context?.id ?? ""}`,
      );
    contextIds.add(context.id);
  }
  const allowed = new Map(contexts.map((context) => [context.id, context]));
  const allowedAttachmentKeys = new Set(allowedAttachments ?? []);
  const seen = new Set();
  const raw = Array.isArray(root.results)
    ? root.results
    : Array.isArray(root.contexts)
      ? root.contexts
      : (0, json_1.readArray)(root.results, "results");
  const results = raw.map((entry, index) => {
    const object = (0, json_1.readObject)(entry, `citationStance[${index}]`);
    const contextId = String(object.contextId ?? object.id ?? "").trim();
    const source = allowed.get(contextId);
    if (!source) throw new Error(`Unknown citation context ${contextId}`);
    if (seen.has(contextId))
      throw new Error(`Duplicate citation context ${contextId}`);
    seen.add(contextId);
    const rawStance = enumValue(object.stance, "citation stance", STANCES);
    const stance = rawStance === "unclear" ? "uncertain" : rawStance;
    const confidence = optionalUnitInterval(
      object.confidence,
      `citationStance[${index}].confidence`,
    );
    return {
      contextId,
      ...(typeof object.targetClaimId === "string" &&
      object.targetClaimId.trim()
        ? { targetClaimId: object.targetClaimId.trim() }
        : source.targetClaimId
          ? { targetClaimId: source.targetClaimId }
          : {}),
      stance,
      ...(confidence !== undefined ? { confidence } : {}),
      rationale:
        typeof object.rationale === "string" ? object.rationale.trim() : "",
      ...(typeof object.claim === "string" && object.claim.trim()
        ? { claim: object.claim.trim() }
        : {}),
      limitations: Array.isArray(object.limitations)
        ? object.limitations
            .filter((value) => typeof value === "string" && !!value.trim())
            .map((value) => value.trim())
        : [],
      evidence: (0, types_1.normalizeEvidenceReferences)(object.evidence, {
        allowedAttachmentKeys,
      }),
    };
  });
  return contexts.map(
    (context) =>
      results.find((result) => result.contextId === context.id) ?? {
        contextId: context.id,
        ...(context.targetClaimId
          ? { targetClaimId: context.targetClaimId }
          : {}),
        stance: "uncertain",
        rationale: "No classification returned.",
        limitations: ["Missing model output"],
        evidence: [],
      },
  );
}
function parseCitationStanceResponse(responseOrParams, contexts) {
  return typeof responseOrParams === "string"
    ? parse(responseOrParams, contexts ?? [])
    : parse(
        responseOrParams.response,
        responseOrParams.contexts,
        responseOrParams.allowedAttachments,
      );
}

export { parseCitationStanceResponse };
