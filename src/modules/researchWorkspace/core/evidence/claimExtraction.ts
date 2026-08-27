// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as claimLedger_1 from "./claimLedger";
import * as types_1 from "./types";
import * as json_1 from "../comprehensionCheck/v2/json";
const VERIFICATION_STATUSES = new Set([
  "verified",
  "partially_verified",
  "unverified",
  "conflicting",
]);
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be object`);
  return value;
}
function sourceBlock(tag, value) {
  const escaped = String(value).replace(
    new RegExp(`</${tag}`, "gi"),
    `<\\/${tag}`,
  );
  return `<${tag} trust="source-data">\n${escaped}\n</${tag}>`;
}
function buildClaimExtractionPrompt(params) {
  return `Extract an evidence-grounded claim ledger in ${params.responseLanguage || "English"}. Return JSON only: {claims:[{id,text,kind,confidence,support,contradictions,verificationStatus}]}.
Kinds: author_claim, empirical_result, assumption, reader_inference, external_evidence. Verification status: verified, partially_verified, unverified, conflicting.
Use attachmentKey ${JSON.stringify(params.attachmentKey)}. Separate what authors state from reader inference. Do not treat abstract rhetoric as verified without evidence.
${sourceBlock("paper_context", params.paperContext)}`;
}
function parseClaimExtractionResponse(params) {
  const root = (0, json_1.extractLastJsonObject)(params.response);
  const allowed = new Set([params.attachmentKey]);
  let ledger = (0, claimLedger_1.createClaimLedger)(
    params.paperKey ?? params.attachmentKey,
    params.now,
  );
  for (const [index, entry] of (0, json_1.readArray)(
    root.claims,
    "claims",
  ).entries()) {
    const claim = object(entry, `claim[${index}]`);
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
      id: String(claim.id || `claim-${index + 1}`),
      text: String(claim.text || "").trim(),
      kind: String(claim.kind || "reader_inference"),
      confidence: Math.max(0, Math.min(1, Number(claim.confidence) || 0)),
      support,
      contradictions,
      verificationStatus,
    });
  }
  return ledger;
}

export { buildClaimExtractionPrompt, parseClaimExtractionResponse };
