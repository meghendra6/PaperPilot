"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createResearchMonitor = void 0;
exports.createResearchMonitorQuery = createResearchMonitorQuery;
exports.isResearchMonitorDue = isResearchMonitorDue;
exports.markResearchMonitorRun = markResearchMonitorRun;
exports.candidateIdentifier = candidateIdentifier;
exports.deduplicateMonitorCandidates = deduplicateMonitorCandidates;
exports.rankMonitorCandidates = rankMonitorCandidates;
exports.rankMonitorDecisions = rankMonitorDecisions;
const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 30, quarterly: 91 };
function isoPlus(now, days) { const date = new Date(now); if (!Number.isFinite(date.getTime()))
    throw new Error(`Invalid monitor date ${now}`); date.setUTCDate(date.getUTCDate() + Math.max(1, Math.floor(days))); return date.toISOString(); }
function createResearchMonitorQuery(params) {
    const now = params.now ?? new Date().toISOString();
    const cadence = params.cadence ?? (params.cadenceDays ? "custom" : "weekly");
    const cadenceDays = Math.max(1, Math.min(365, Math.floor(params.cadenceDays ?? (cadence === "custom" ? 7 : CADENCE_DAYS[cadence]))));
    const name = (params.name || params.label || "").trim();
    if (!name || !params.query.trim())
        throw new Error("Monitor name and query are required.");
    const next = isoPlus(now, cadenceDays);
    return { id: params.id, name, label: name, query: params.query.trim(), ...(params.collectionKey ? { collectionKey: params.collectionKey } : {}), cadence, cadenceDays, nextRunAt: next, nextCheckAt: next, enabled: true, createdAt: now, seenIdentifiers: [] };
}
exports.createResearchMonitor = createResearchMonitorQuery;
function isResearchMonitorDue(query, now = new Date().toISOString()) { return query.enabled && new Date(query.nextRunAt).getTime() <= new Date(now).getTime(); }
function markResearchMonitorRun(query, identifiers, now = new Date().toISOString()) { const next = isoPlus(now, query.cadenceDays); return { ...query, lastRunAt: now, nextRunAt: next, nextCheckAt: next, seenIdentifiers: [...new Set([...query.seenIdentifiers, ...identifiers.map((value) => value.toLowerCase())])].slice(-5000) }; }
function candidateIdentifier(candidate) { return (candidate.doi || candidate.url || `${candidate.title}:${candidate.year || ""}`).trim().toLowerCase(); }
function deduplicateMonitorCandidates(candidates, seen = []) {
    const blocked = new Set(seen.map((value) => value.toLowerCase()));
    const found = new Set();
    const result = [];
    for (const candidate of candidates) {
        const id = candidateIdentifier(candidate);
        if (!id || blocked.has(id) || found.has(id))
            continue;
        if (!candidate.doi && !candidate.url)
            continue;
        found.add(id);
        result.push({ ...candidate, id });
    }
    return result;
}
function rankMonitorCandidates(candidates, scores) {
    return candidates.map((candidate) => {
        const score = scores[candidate.id] || { relevance: 0, novelty: 0, evidenceValue: 0 };
        const relevance = Math.max(0, Math.min(1, Number(score.relevance) || 0));
        const novelty = Math.max(0, Math.min(1, Number(score.novelty) || 0));
        const evidenceValue = Math.max(0, Math.min(1, Number(score.evidenceValue) || 0));
        const overall = 0.5 * relevance + 0.2 * novelty + 0.3 * evidenceValue;
        return { ...candidate, relevance, novelty, evidenceValue, overall, reasons: score.reasons || [], recommendedAction: overall >= 0.75 ? "add" : overall >= 0.45 ? "review" : "ignore" };
    }).sort((left, right) => right.overall - left.overall);
}
function rankMonitorDecisions(decisions, monitor) {
    if (decisions.some((decision) => "candidateId" in decision || "overallScore" in decision)) {
        return decisions
            .map((decision) => {
            const overall = Math.max(0, Math.min(1, Number(decision.overallScore) || (0.5 * (Number(decision.relevanceScore) || 0) + 0.2 * (Number(decision.noveltyScore) || 0) + 0.3 * (Number(decision.evidenceScore) || 0))));
            return {
                ...decision,
                monitorId: decision.monitorId || monitor?.id,
                overallScore: overall,
                recommendedAction: overall >= 0.75 ? "save" : overall >= 0.45 ? "review" : "ignore",
            };
        })
            .sort((left, right) => right.overallScore - left.overallScore);
    }
    const candidates = decisions.map(({ relevance: _r, novelty: _n, evidenceValue: _e, reasons: _rs, recommendedAction: _a, ...candidate }) => candidate);
    const scores = Object.fromEntries(decisions.map((decision) => [decision.id, { relevance: decision.relevance ?? 0, novelty: decision.novelty ?? 0, evidenceValue: decision.evidenceValue ?? 0, reasons: decision.reasons, recommendedAction: decision.recommendedAction }]));
    return rankMonitorCandidates(candidates, scores);
}
