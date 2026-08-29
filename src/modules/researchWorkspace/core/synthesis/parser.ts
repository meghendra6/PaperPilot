import {
  extractLastJsonObject,
  readArray,
  readObject,
  readOptionalString,
  readString,
} from "../comprehensionCheck/v2/json";
import { normalizeEvidenceReferences } from "../evidence/types";

const SUPPORT = new Set(["verified", "inferred", "insufficient"]);

function strings(
  value: unknown,
  field: string,
  allowedSourceIDs?: Set<string>,
) {
  const result = readArray(value, field).map((entry, index) =>
    readString(entry, `${field}[${index}]`),
  );
  if (allowedSourceIDs) {
    for (const sourceID of result) {
      if (!allowedSourceIDs.has(sourceID)) {
        throw new Error(`${field} contains unknown SourceID ${sourceID}.`);
      }
    }
  }
  return [...new Set(result)];
}

function statementList(
  value: unknown,
  field: string,
  allowedSourceIDs: Set<string>,
  allowedAttachmentKeys: Set<string>,
) {
  return readArray(value, field).map((entry, index) => {
    const object = readObject(entry, `${field}[${index}]`);
    const sourceIDs = strings(
      object.sourceIDs,
      `${field}[${index}].sourceIDs`,
      allowedSourceIDs,
    );
    const evidence = normalizeEvidenceReferences(object.evidence, {
      allowedAttachmentKeys,
    });
    for (const reference of evidence) {
      if (!reference.sourceID || !allowedSourceIDs.has(reference.sourceID)) {
        throw new Error(
          `${field}[${index}] contains evidence for an unknown SourceID.`,
        );
      }
    }
    const requestedSupport = String(object.support ?? "inferred").trim();
    if (!SUPPORT.has(requestedSupport)) {
      throw new Error(`${field}[${index}].support is invalid.`);
    }
    const uncertainty = readOptionalString(object.uncertainty);
    return {
      statement: readString(
        object.statement ?? object.claim,
        `${field}[${index}].statement`,
      ),
      sourceIDs,
      evidence,
      support:
        requestedSupport === "verified" && evidence.length === 0
          ? "inferred"
          : requestedSupport,
      ...(uncertainty ? { uncertainty } : {}),
    };
  });
}

export function parseProjectSynthesisResponse(params: {
  response: string;
  allowedSourceIDs: Set<string>;
  allowedAttachmentKeys: Set<string>;
}) {
  const root = extractLastJsonObject(params.response);
  const parsed = {
    answer: readString(root.answer, "answer"),
    claims: statementList(
      root.claims,
      "claims",
      params.allowedSourceIDs,
      params.allowedAttachmentKeys,
    ),
    agreements: statementList(
      root.agreements ?? [],
      "agreements",
      params.allowedSourceIDs,
      params.allowedAttachmentKeys,
    ),
    contradictions: statementList(
      root.contradictions ?? [],
      "contradictions",
      params.allowedSourceIDs,
      params.allowedAttachmentKeys,
    ),
    unresolvedUncertainty: strings(
      root.unresolvedUncertainty ?? [],
      "unresolvedUncertainty",
    ),
    freshnessWarnings: strings(
      root.freshnessWarnings ?? [],
      "freshnessWarnings",
    ),
  };
  if (!parsed.claims.length) {
    throw new Error("Project synthesis must contain at least one claim.");
  }
  return parsed;
}

function hasVerifiedEvidence(entry: { evidence?: unknown[] }) {
  return Boolean(
    entry.evidence?.some(
      (reference) =>
        Boolean(reference) &&
        typeof reference === "object" &&
        !Array.isArray(reference) &&
        (reference as { verification?: { status?: string } }).verification
          ?.status === "verified",
    ),
  );
}

type SynthesisEvidenceEntry = {
  evidence?: unknown[];
  support?: string;
};

type FinalizedSynthesisEntry<T> = T & {
  support: "verified" | "inferred" | "insufficient";
  paperSupported: boolean;
};

export function finalizeProjectSynthesisEvidence<
  TClaim extends SynthesisEvidenceEntry,
  TAgreement extends SynthesisEvidenceEntry,
  TContradiction extends SynthesisEvidenceEntry,
  T extends {
    claims: TClaim[];
    agreements: TAgreement[];
    contradictions: TContradiction[];
  },
>(
  value: T,
): Omit<T, "claims" | "agreements" | "contradictions"> & {
  claims: Array<FinalizedSynthesisEntry<TClaim>>;
  agreements: Array<FinalizedSynthesisEntry<TAgreement>>;
  contradictions: Array<FinalizedSynthesisEntry<TContradiction>>;
} {
  const close = <TEntry extends SynthesisEvidenceEntry>(
    entry: TEntry,
  ): FinalizedSynthesisEntry<TEntry> =>
    hasVerifiedEvidence(entry)
      ? { ...entry, support: "verified", paperSupported: true }
      : {
          ...entry,
          support:
            entry.support === "insufficient" ? "insufficient" : "inferred",
          paperSupported: false,
        };
  return {
    ...value,
    claims: value.claims.map(close),
    agreements: value.agreements.map(close),
    contradictions: value.contradictions.map(close),
  };
}
