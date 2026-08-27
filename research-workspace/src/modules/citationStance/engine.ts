"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeCitationStances = summarizeCitationStances;
function summarizeCitationStances(results) {
    const count = (stance) => results.filter((result) => result.stance === stance).length;
    const total = results.length;
    const supporting = count("supporting");
    const contrasting = count("contrasting");
    const mentioning = count("mentioning");
    const methodological = count("methodological");
    const unclear = count("unclear");
    const weighted = results.reduce((sum, result) => sum + (result.stance === "supporting" ? result.confidence : result.stance === "contrasting" ? -result.confidence : 0), 0);
    const weightedBalance = total ? weighted / total : 0;
    return {
        total, supporting, contrasting, mentioning, methodological, unclear,
        weightedSupport: weightedBalance,
        weightedBalance,
        conflictRate: supporting + contrasting ? contrasting / (supporting + contrasting) : 0,
        classifiedRate: total ? (total - unclear) / total : 0,
    };
}