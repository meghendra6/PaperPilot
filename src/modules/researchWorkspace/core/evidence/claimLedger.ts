import type { ClaimInput, ClaimLedger, PaperClaim } from "../contracts";
import type { EvidenceReference } from "./types";
import * as types_1 from "./types";
const CLAIM_KINDS = new Set([
  "author_claim",
  "empirical_result",
  "assumption",
  "reader_inference",
  "external_evidence",
]);
function requiredText(value: string, fieldName: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName} cannot be empty.`);
  return normalized.slice(0, maxLength);
}
function normalizedConfidence(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value))
    throw new Error("Claim confidence must be finite.");
  return Math.min(1, Math.max(0, value));
}
function inferClaimVerificationStatus(
  support: EvidenceReference[],
  contradictions: EvidenceReference[],
) {
  if (contradictions.length > 0) return "conflicting";
  if (support.length === 0) return "unverified";
  const strongSupport = support.some(
    (reference) => (reference.confidence ?? 0.5) >= 0.8,
  );
  return strongSupport ? "verified" : "partially_verified";
}
function inferLocalEvidenceVerificationStatus(
  support: EvidenceReference[],
  contradictions: EvidenceReference[],
) {
  const locallyVerified = (reference: EvidenceReference) =>
    reference?.verification?.status === "verified";
  if (contradictions.some(locallyVerified)) return "conflicting";
  const verifiedSupport = support.filter(locallyVerified).length;
  if (verifiedSupport === 0) return "unverified";
  if (verifiedSupport === support.length && contradictions.length === 0) {
    return "verified";
  }
  return "partially_verified";
}
function reconcileClaimLedgerEvidenceStatus<
  T extends {
    claims: {
      support: EvidenceReference[];
      contradictions: EvidenceReference[];
    }[];
  },
>(ledger: T, now = new Date().toISOString()) {
  return {
    ...ledger,
    claims: ledger.claims.map((claim) => ({
      ...claim,
      verificationStatus: inferLocalEvidenceVerificationStatus(
        claim.support,
        claim.contradictions,
      ),
      updatedAt: now,
    })),
    updatedAt: now,
  };
}
function createPaperClaim(input: ClaimInput & { now: string }): PaperClaim {
  if (!CLAIM_KINDS.has(input.kind))
    throw new Error(`Unsupported claim kind: ${input.kind}`);
  const id = requiredText(input.id, "Claim ID", 256);
  const text = requiredText(input.text, "Claim text", 4000);
  const support = (0, types_1.normalizeEvidenceReferences)(
    input.support,
    input.evidenceOptions,
  );
  const contradictions = (0, types_1.normalizeEvidenceReferences)(
    input.contradictions,
    input.evidenceOptions,
  );
  return {
    id,
    text,
    kind: input.kind,
    support,
    contradictions,
    ...(normalizedConfidence(input.confidence) !== undefined
      ? { confidence: normalizedConfidence(input.confidence) }
      : {}),
    verificationStatus: inferClaimVerificationStatus(support, contradictions),
    createdAt: input.now,
    updatedAt: input.now,
  };
}
function mergePaperClaims(
  base: PaperClaim,
  incoming: PaperClaim,
  now: string,
): PaperClaim {
  if (base.id !== incoming.id) {
    throw new Error(
      `Cannot merge claims with different IDs: ${base.id} and ${incoming.id}`,
    );
  }
  const supportByKey = new Map<string, EvidenceReference>();
  const contradictionsByKey = new Map<string, EvidenceReference>();
  for (const reference of [...base.support, ...incoming.support]) {
    supportByKey.set((0, types_1.evidenceReferenceKey)(reference), reference);
  }
  for (const reference of [
    ...base.contradictions,
    ...incoming.contradictions,
  ]) {
    contradictionsByKey.set(
      (0, types_1.evidenceReferenceKey)(reference),
      reference,
    );
  }
  const support = [...supportByKey.values()];
  const contradictions = [...contradictionsByKey.values()];
  return {
    ...base,
    text: incoming.text || base.text,
    kind: incoming.kind,
    support,
    contradictions,
    ...([base.confidence, incoming.confidence].some(Number.isFinite)
      ? {
          confidence: Math.max(
            ...[base.confidence, incoming.confidence].filter(
              (value): value is number =>
                typeof value === "number" && Number.isFinite(value),
            ),
          ),
        }
      : {}),
    verificationStatus: inferClaimVerificationStatus(support, contradictions),
    updatedAt: now,
  };
}
function summarizeClaimLedger(claims: PaperClaim[]) {
  const summary = {
    total: claims.length,
    verified: 0,
    partiallyVerified: 0,
    unverified: 0,
    conflicting: 0,
    unsupportedClaimIds: [] as string[],
  };
  for (const claim of claims) {
    switch (claim.verificationStatus) {
      case "verified":
        summary.verified += 1;
        break;
      case "partially_verified":
        summary.partiallyVerified += 1;
        break;
      case "conflicting":
        summary.conflicting += 1;
        break;
      case "unverified":
        summary.unverified += 1;
        summary.unsupportedClaimIds.push(claim.id);
        break;
    }
  }
  return summary;
}
function createClaimLedger(
  paperKey: string,
  now = new Date().toISOString(),
): ClaimLedger {
  return {
    schemaVersion: 1,
    paperKey: requiredText(paperKey, "Paper key", 512),
    claims: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}
function addClaim(
  ledger: ClaimLedger,
  input: ClaimInput,
  now = new Date().toISOString(),
): ClaimLedger {
  const normalized = createPaperClaim({
    id: input.id,
    text: input.text,
    kind: input.kind,
    support: input.support,
    contradictions: input.contradictions,
    confidence: input.confidence,
    now: input.createdAt || now,
  });
  const incoming = {
    ...normalized,
    // A supplied status may only make the state more conservative. It may not
    // turn unsupported evidence into a verified claim.
    verificationStatus:
      input.verificationStatus === "conflicting"
        ? "conflicting"
        : input.verificationStatus === "unverified" &&
            normalized.verificationStatus !== "conflicting"
          ? "unverified"
          : normalized.verificationStatus,
    updatedAt: input.updatedAt || now,
  };
  const index = ledger.claims.findIndex((claim) => claim.id === incoming.id);
  const claims = ledger.claims.slice();
  if (index >= 0) {
    claims[index] = mergePaperClaims(ledger.claims[index], incoming, now);
  } else {
    claims.push(incoming);
  }
  return {
    ...ledger,
    claims,
    revision: ledger.revision + 1,
    updatedAt: now,
  };
}
function removeClaim(
  ledger: ClaimLedger,
  claimId: string,
  now = new Date().toISOString(),
) {
  const claims = ledger.claims.filter((claim) => claim.id !== claimId);
  if (claims.length === ledger.claims.length) return ledger;
  return {
    ...ledger,
    claims,
    revision: ledger.revision + 1,
    updatedAt: now,
  };
}
function summarizeVersionedClaimLedger(ledger: ClaimLedger) {
  return summarizeClaimLedger(ledger.claims);
}

export {
  addClaim,
  createClaimLedger,
  createPaperClaim,
  inferClaimVerificationStatus,
  inferLocalEvidenceVerificationStatus,
  mergePaperClaims,
  reconcileClaimLedgerEvidenceStatus,
  removeClaim,
  summarizeClaimLedger,
  summarizeVersionedClaimLedger,
};
