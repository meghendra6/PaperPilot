"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProfiledCriticalReadResponse = parseProfiledCriticalReadResponse;
const types_1 = __require("src/modules/evidence/types.ts");
const profiles_1 = __require("src/modules/criticalRead/profiled/profiles.ts");
const json_1 = __require("src/modules/comprehensionCheck/v2/json.ts");
function object(value, name) { if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`); return value; }
function array(value, name) { if (!Array.isArray(value))
    throw new Error(`${name} must be an array`); return value; }
function string(value, name) { if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string`); return value.trim(); }
function strings(value) { return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()) : []; }
function clamp(value) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
const STATUSES = new Set(["supported", "partial", "unsupported", "not_applicable", "unclear"]);
const SEVERITIES = new Set(["none", "minor", "major", "critical"]);
function parseProfiledCriticalReadResponse(params) {
    const root = object((0, json_1.extractLastJsonObject)(params.response), "response");
    const profile = (0, profiles_1.getCriticalReadProfile)(params.profile);
    const expected = new Set(profile.checks.map((entry) => entry.id));
    const seen = new Set();
    const allowed = new Set([params.attachmentKey]);
    const checks = array(root.checks, "checks").map((entry, index) => {
        const value = object(entry, `checks[${index}]`);
        const checkId = string(value.checkId, `checks[${index}].checkId`);
        if (!expected.has(checkId))
            throw new Error(`Unknown checkId ${checkId}`);
        if (seen.has(checkId))
            throw new Error(`Duplicate checkId ${checkId}`);
        seen.add(checkId);
        const rawStatus = string(value.status, `checks[${index}].status`);
        const rawSeverity = string(value.severity, `checks[${index}].severity`);
        if (!STATUSES.has(rawStatus))
            throw new Error(`Invalid status ${rawStatus}`);
        if (!SEVERITIES.has(rawSeverity))
            throw new Error(`Invalid severity ${rawSeverity}`);
        return { checkId, status: rawStatus, severity: rawSeverity, finding: string(value.finding, "finding"), implication: string(value.implication, "implication"), evidence: (0, types_1.normalizeEvidenceReferences)(value.evidence, { allowedAttachmentKeys: allowed }), confidence: clamp(value.confidence) };
    });
    const missing = profile.checks.filter((entry) => !seen.has(entry.id));
    if (missing.length)
        throw new Error(`Missing checks: ${missing.map((entry) => entry.id).join(", ")}`);
    const experiments = (Array.isArray(root.discriminatingExperiments) ? root.discriminatingExperiments : []).map((entry, index) => {
        const value = object(entry, `discriminatingExperiments[${index}]`);
        return { hypothesis: string(value.hypothesis, "hypothesis"), experiment: string(value.experiment, "experiment"), expectedOutcomes: strings(value.expectedOutcomes), evidence: (0, types_1.normalizeEvidenceReferences)(value.evidence, { allowedAttachmentKeys: allowed }) };
    });
    return { schemaVersion: 1, id: `critical-read-${params.paperKey}-${Date.now()}`, paperKey: params.paperKey, attachmentKey: params.attachmentKey, profile: params.profile, executiveSummary: string(root.executiveSummary, "executiveSummary"), strengths: strings(root.strengths), checks, discriminatingExperiments: experiments, residualUncertainty: strings(root.residualUncertainty), createdAt: params.now ?? new Date().toISOString() };
}
