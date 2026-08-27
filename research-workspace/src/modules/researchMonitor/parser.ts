"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMonitorDiscoveryResponse = parseMonitorDiscoveryResponse;
exports.parseResearchMonitorDiscoveryResponse = parseResearchMonitorDiscoveryResponse;
exports.parseMonitorRankingResponse = parseMonitorRankingResponse;
const json_1 = __require("src/modules/comprehensionCheck/v2/json.ts");
const engine_1 = __require("src/modules/researchMonitor/engine.ts");
function parseDiscovery(response, seen = []) {
    const root = (0, json_1.extractLastJsonObject)(response);
    const candidates = (0, json_1.readArray)(root.candidates, "candidates").map((entry, index) => {
        const object = (0, json_1.readObject)(entry, `candidates[${index}]`);
        const title = String(object.title ?? "").trim();
        const doi = typeof object.doi === "string" && object.doi.trim() ? object.doi.trim() : undefined;
        const url = typeof object.url === "string" && object.url.trim() ? object.url.trim() : undefined;
        if (!title)
            throw new Error("Candidate title is required.");
        if (doi && !/^10\.\d{4,9}\//i.test(doi))
            throw new Error(`Invalid DOI ${doi}`);
        if (url) {
            try {
                const parsed = new URL(url);
                if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname)
                    throw new Error();
            }
            catch {
                throw new Error(`Invalid URL ${url}`);
            }
        }
        if (!doi && !url)
            throw new Error(`Candidate ${title} needs a DOI or direct URL.`);
        return {
            id: String(object.id ?? doi ?? url ?? title), title,
            authors: Array.isArray(object.authors) ? object.authors.filter((value) => typeof value === "string" && !!value.trim()).map((value) => value.trim()) : [],
            ...(Number.isFinite(Number(object.year)) ? { year: Number(object.year) } : {}), ...(doi ? { doi } : {}), ...(url ? { url } : {}),
            ...(typeof object.abstract === "string" ? { abstract: object.abstract } : {}), ...(typeof object.venue === "string" ? { venue: object.venue } : {}),
            ...(typeof object.publishedAt === "string" ? { publishedAt: object.publishedAt } : {}), source: String(object.source ?? "agent"),
            ...(Array.isArray(object.sourceEvidence) ? { sourceEvidence: object.sourceEvidence.filter((value) => typeof value === "string") } : {}),
        };
    });
    return (0, engine_1.deduplicateMonitorCandidates)(candidates, seen);
}
function parseMonitorDiscoveryResponse(response, seen = []) { return parseDiscovery(response, seen); }
function parseResearchMonitorDiscoveryResponse(params) { return parseDiscovery(params.response, params.seenIdentifiers); }
function parseMonitorRankingResponse(response, candidates) {
    const root = (0, json_1.extractLastJsonObject)(response);
    const scores = {};
    const seen = new Set();
    const rawScores = Array.isArray(root.scores) ? root.scores : Array.isArray(root.decisions) ? root.decisions : null;
    if (!rawScores)
        throw new Error("Monitor ranking must include scores.");
    for (const entry of rawScores) {
        const object = (0, json_1.readObject)(entry, "monitor score");
        const id = String(object.id ?? "");
        if (!candidates.some((candidate) => candidate.id === id))
            throw new Error(`Unknown monitor candidate ${id}`);
        if (seen.has(id))
            throw new Error(`Duplicate monitor candidate score ${id}`);
        seen.add(id);
        const relevance = Number(object.relevance);
        const novelty = Number(object.novelty);
        const evidenceValue = Number(object.evidenceValue);
        if (![relevance, novelty, evidenceValue].every(Number.isFinite))
            throw new Error(`Monitor candidate ${id} requires finite scores.`);
        scores[id] = { relevance, novelty, evidenceValue, reasons: Array.isArray(object.reasons) ? object.reasons.filter((value) => typeof value === "string") : [] };
    }
    for (const candidate of candidates)
        if (!seen.has(candidate.id))
            throw new Error(`Missing monitor candidate score ${candidate.id}`);
    return (0, engine_1.rankMonitorCandidates)(candidates, scores);
}
