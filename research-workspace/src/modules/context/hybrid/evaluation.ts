"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateHybridRetrieval = evaluateHybridRetrieval;
const search_1 = __require("src/modules/context/hybrid/search.ts");
function ndcg(returned, relevant) {
    let dcg = 0;
    returned.forEach((id, index) => { if (relevant.has(id))
        dcg += 1 / Math.log2(index + 2); });
    let ideal = 0;
    for (let index = 0; index < Math.min(returned.length, relevant.size); index += 1)
        ideal += 1 / Math.log2(index + 2);
    return ideal ? dcg / ideal : 0;
}
function evaluateHybridRetrieval(index, cases, k = 5) {
    const effectiveK = Math.max(1, Math.floor(k));
    const perCase = cases.map((entry) => {
        const returned = (0, search_1.searchHybridIndex)(index, entry.query, { topK: effectiveK }).map((result) => result.chunk.id);
        const relevant = new Set(entry.relevantChunkIds);
        const relevantFound = returned.filter((id) => relevant.has(id));
        const first = returned.findIndex((id) => relevant.has(id));
        return { id: entry.id, returned, relevantFound, reciprocalRank: first >= 0 ? 1 / (first + 1) : 0, ndcg: ndcg(returned, relevant) };
    });
    const denominator = Math.max(1, cases.length);
    return {
        caseCount: cases.length,
        k: effectiveK,
        recallAtK: perCase.reduce((sum, entry, indexValue) => sum + entry.relevantFound.length / Math.max(1, cases[indexValue].relevantChunkIds.length), 0) / denominator,
        precisionAtK: perCase.reduce((sum, entry) => sum + entry.relevantFound.length / effectiveK, 0) / denominator,
        meanReciprocalRank: perCase.reduce((sum, entry) => sum + entry.reciprocalRank, 0) / denominator,
        normalizedDiscountedCumulativeGain: perCase.reduce((sum, entry) => sum + entry.ndcg, 0) / denominator,
        perCase,
    };
}