export const CITATION_STANCE_VALUES = [
  "supporting",
  "contrasting",
  "methodological",
  "mentioning",
  "background",
  "uncertain",
] as const;

export type CitationStanceValue = (typeof CITATION_STANCE_VALUES)[number];

export interface CitationStanceCorrectionEvent {
  eventID: string;
  submissionID: string;
  contextID: string;
  previousStance: string;
  stance: CitationStanceValue;
  reason: string;
  actor: "user";
  expectedRevision: number;
  createdAt: string;
}

type CitationPayload = {
  schemaVersion?: number;
  revision?: number;
  contexts?: Array<{ id?: string; [key: string]: unknown }>;
  results?: Array<{
    contextId?: string;
    stance?: string;
    [key: string]: unknown;
  }>;
  corrections?: CitationStanceCorrectionEvent[];
  [key: string]: unknown;
};

function normalizedReason(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function applyCitationStanceCorrection(params: {
  payload: CitationPayload;
  contextID: string;
  stance: CitationStanceValue;
  reason: string;
  expectedRevision: number;
  submissionID: string;
  eventID: string;
  now?: Date;
}) {
  if (!CITATION_STANCE_VALUES.includes(params.stance)) {
    throw new Error(`Invalid citation stance ${params.stance}.`);
  }
  if (!params.contextID.trim() || !params.submissionID.trim()) {
    throw new Error("Citation correction requires context and submission IDs.");
  }
  const reason = normalizedReason(params.reason);
  if (!reason) throw new Error("Explain why the citation stance is changing.");
  const contexts = Array.isArray(params.payload.contexts)
    ? params.payload.contexts
    : [];
  if (!contexts.some((context) => context.id === params.contextID)) {
    throw new Error("Citation context not found.");
  }
  const results = Array.isArray(params.payload.results)
    ? params.payload.results
    : [];
  const current = results.find(
    (result) => result.contextId === params.contextID,
  );
  if (!current) throw new Error("Citation stance result not found.");
  const corrections = Array.isArray(params.payload.corrections)
    ? params.payload.corrections
    : [];
  const duplicate = corrections.find(
    (event) => event.submissionID === params.submissionID,
  );
  if (duplicate) {
    if (
      duplicate.contextID !== params.contextID ||
      duplicate.stance !== params.stance ||
      normalizedReason(duplicate.reason) !== reason
    ) {
      throw new Error(
        "Citation correction idempotency conflict: this submission ID was already used for different input.",
      );
    }
    return params.payload;
  }
  const revision = Number(params.payload.revision ?? 0);
  if (!Number.isInteger(revision) || revision !== params.expectedRevision) {
    throw new Error(
      `Citation correction revision conflict: expected ${params.expectedRevision}, found ${revision}.`,
    );
  }
  const event: CitationStanceCorrectionEvent = {
    eventID: params.eventID,
    submissionID: params.submissionID,
    contextID: params.contextID,
    previousStance: String(current.stance ?? "uncertain"),
    stance: params.stance,
    reason,
    actor: "user",
    expectedRevision: revision,
    createdAt: (params.now ?? new Date()).toISOString(),
  };
  return {
    ...params.payload,
    schemaVersion: 1,
    revision: revision + 1,
    results: results.map((result) =>
      result.contextId === params.contextID
        ? {
            ...result,
            modelStance: result.modelStance ?? result.stance,
            stance: params.stance,
            correctionReason: reason,
            correctedBy: "user",
          }
        : result,
    ),
    corrections: [...corrections, event],
  };
}
