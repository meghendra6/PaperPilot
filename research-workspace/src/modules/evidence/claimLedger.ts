"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferClaimVerificationStatus = inferClaimVerificationStatus;
exports.createPaperClaim = createPaperClaim;
exports.mergePaperClaims = mergePaperClaims;
exports.summarizeClaimLedger = summarizeClaimLedger;
exports.createClaimLedger = createClaimLedger;
exports.addClaim = addClaim;
exports.removeClaim = removeClaim;
exports.summarizeVersionedClaimLedger = summarizeVersionedClaimLedger;
const types_1 = __require("src/modules/evidence/types.ts");
const CLAIM_KINDS = new Set([
    "author_claim",
    "empirical_result",
    "assumption",
    "reader_inference",
    "external_evidence",
]);
function requiredText(value, fieldName, maxLength) {
    const normalized = value.trim();
    if (!normalized)
        throw new Error(`${fieldName} cannot be empty.`);
    return normalized.slice(0, maxLength);
}
function normalizedConfidence(value) {
    if (value === undefined)
        return 0.5;
    if (!Number.isFinite(value))
        throw new Error("Claim confidence must be finite.");
    return Math.min(1, Math.max(0, value));
}
function inferClaimVerificationStatus(support, contradictions) {
    if (contradictions.length > 0)
        return "conflicting";
    if (support.length === 0)
        return "unverified";
    const strongSupport = support.some((reference) => (reference.confidence ?? 0.5) >= 0.8);
    return strongSupport ? "verified" : "partially_verified";
}
function createPaperClaim(input) {
    if (!CLAIM_KINDS.has(input.kind))
        throw new Error(`Unsupported claim kind: ${input.kind}`);
    const id = requiredText(input.id, "Claim ID", 256);
    const text = requiredText(input.text, "Claim text", 4000);
    const support = (0, types_1.normalizeEvidenceReferences)(input.support, input.evidenceOptions);
    const contradictions = (0, types_1.normalizeEvidenceReferences)(input.contradictions, input.evidenceOptions);
    return {
        id,
        text,
        kind: input.kind,
        support,
        contradictions,
        confidence: normalizedConfidence(input.confidence),
        verificationStatus: inferClaimVerificationStatus(support, contradictions),
        createdAt: input.now,
        updatedAt: input.now,
    };
}
function mergePaperClaims(base, incoming, now) {
    if (base.id !== incoming.id) {
        throw new Error(`Cannot merge claims with different IDs: ${base.id} and ${incoming.id}`);
    }
    const supportByKey = new Map();
    const contradictionsByKey = new Map();
    for (const reference of [...base.support, ...incoming.support]) {
        supportByKey.set((0, types_1.evidenceReferenceKey)(reference), reference);
    }
    for (const reference of [...base.contradictions, ...incoming.contradictions]) {
        contradictionsByKey.set((0, types_1.evidenceReferenceKey)(reference), reference);
    }
    const support = [...supportByKey.values()];
    const contradictions = [...contradictionsByKey.values()];
    return {
        ...base,
        text: incoming.text || base.text,
        kind: incoming.kind,
        support,
        contradictions,
        confidence: Math.max(base.confidence, incoming.confidence),
        verificationStatus: inferClaimVerificationStatus(support, contradictions),
        updatedAt: now,
    };
}
function summarizeClaimLedger(claims) {
    const summary = {
        total: claims.length,
        verified: 0,
        partiallyVerified: 0,
        unverified: 0,
        conflicting: 0,
        unsupportedClaimIds: [],
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
function createClaimLedger(paperKey, now = new Date().toISOString()) {
    return {
        schemaVersion: 1,
        paperKey: requiredText(paperKey, "Paper key", 512),
        claims: [],
        revision: 0,
        createdAt: now,
        updatedAt: now,
    };
}
function addClaim(ledger, input, now = new Date().toISOString()) {
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
        verificationStatus: input.verificationStatus === "conflicting"
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
    }
    else {
        claims.push(incoming);
    }
    return {
        ...ledger,
        claims,
        revision: ledger.revision + 1,
        updatedAt: now,
    };
}
function removeClaim(ledger, claimId, now = new Date().toISOString()) {
    const claims = ledger.claims.filter((claim) => claim.id !== claimId);
    if (claims.length === ledger.claims.length)
        return ledger;
    return {
        ...ledger,
        claims,
        revision: ledger.revision + 1,
        updatedAt: now,
    };
}
function summarizeVersionedClaimLedger(ledger) {
    return summarizeClaimLedger(ledger.claims);
}