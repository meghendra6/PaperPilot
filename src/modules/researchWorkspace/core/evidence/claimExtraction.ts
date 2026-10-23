import { buildEvidenceReferencePromptExample } from "../../outputSchemas";
import * as json_1 from "../comprehensionCheck/v2/json";
import type { PaperPromptInput, PaperResponseInput } from "../contracts";
import { enumValue, optionalUnitInterval } from "../parserValidation";
import * as claimLedger_1 from "./claimLedger";
import * as types_1 from "./types";
const CLAIM_KINDS = new Set([
  "author_claim",
  "empirical_result",
  "assumption",
  "reader_inference",
  "external_evidence",
]);
const VERIFICATION_STATUSES = new Set([
  "verified",
  "partially_verified",
  "unverified",
  "conflicting",
]);
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be object`);
  return value as Record<string, unknown>;
}
function sourceBlock(tag: string, value: unknown) {
  const escaped = String(value).replace(
    new RegExp(`</${tag}`, "gi"),
    `<\\/${tag}`,
  );
  return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildClaimExtractionPrompt(params: PaperPromptInput) {
  const sourceIdentity = params.sourceID
    ? `Every evidence reference must also use sourceID ${JSON.stringify(params.sourceID)} and libraryID ${JSON.stringify(params.libraryID)}.`
    : "";
  const evidenceExample = buildEvidenceReferencePromptExample({
    attachmentKey: params.attachmentKey,
    sourceID: params.sourceID,
    libraryID: params.libraryID,
  });
  return `Extract an evidence-grounded claim ledger in ${params.responseLanguage || "English"}. Return JSON only, following this complete example: ${JSON.stringify({ claims: [{ id: "claim-1", text: "...", kind: "author_claim", confidence: null, support: [evidenceExample], contradictions: [], verificationStatus: "unverified" }] })}.
Kinds: author_claim, empirical_result, assumption, reader_inference, external_evidence. Verification status: verified, partially_verified, unverified, conflicting.
Use attachmentKey ${JSON.stringify(params.attachmentKey)}. Separate what authors state from reader inference. Do not treat abstract rhetoric as verified without evidence.
${sourceIdentity}
${sourceBlock("paper_context", params.paperContext)}`;
}
function parseClaimExtractionResponse(
  params: Omit<PaperResponseInput, "paperKey"> & { paperKey?: string },
) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const allowed = new Set([params.attachmentKey]);
  let ledger = (0, claimLedger_1.createClaimLedger)(
    params.paperKey ?? params.attachmentKey,
    params.now,
  );
  // addClaim merges an existing ID, so a reused ID would attach one claim's
  // support to another claim's text. Duplicates are rejected instead.
  const seenIDs = new Set<string>();
  const entries = (0, json_1.readArray)(root.claims, "claims");
  const explicitIDs = new Set(
    entries
      .map((entry) => (entry as { id?: unknown } | null)?.id)
      .filter((id) => typeof id === "string" && id)
      .map(String),
  );
  for (const [index, entry] of entries.entries()) {
    const claim = object(entry, `claim[${index}]`);
    let claimID = claim.id ? String(claim.id) : "";
    if (claimID && seenIDs.has(claimID))
      throw new Error(`Duplicate claim ID ${claimID}.`);
    if (!claimID) {
      let next = index + 1;
      while (explicitIDs.has(`claim-${next}`) || seenIDs.has(`claim-${next}`))
        next += 1;
      claimID = `claim-${next}`;
    }
    seenIDs.add(claimID);
    const support = (0, types_1.normalizeEvidenceReferences)(claim.support, {
      allowedAttachmentKeys: allowed,
    });
    const contradictions = (0, types_1.normalizeEvidenceReferences)(
      claim.contradictions,
      {
        allowedAttachmentKeys: allowed,
      },
    );
    const inferredStatus = (0, claimLedger_1.inferClaimVerificationStatus)(
      support,
      contradictions,
    );
    const verificationStatus = String(
      claim.verificationStatus || inferredStatus,
    );
    if (!VERIFICATION_STATUSES.has(verificationStatus))
      throw new Error(
        `Unsupported claim verification status: ${verificationStatus}`,
      );
    ledger = (0, claimLedger_1.addClaim)(ledger, {
      id: claimID,
      text: String(claim.text || "").trim(),
      kind: enumValue(claim.kind, `claim[${index}].kind`, CLAIM_KINDS),
      confidence: optionalUnitInterval(
        claim.confidence,
        `claim[${index}].confidence`,
      ),
      support,
      contradictions,
      verificationStatus,
    });
  }
  return ledger;
}

export { buildClaimExtractionPrompt, parseClaimExtractionResponse };
