"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHashEmbedding = createHashEmbedding;
exports.cosineSimilarity = cosineSimilarity;
const tokenizer_1 = __require("src/modules/context/hybrid/tokenizer.ts");
function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}
function createHashEmbedding(text, dimensions = 192) {
    const vector = Array.from({ length: dimensions }, () => 0);
    const tokens = (0, tokenizer_1.tokenizeHybridOccurrences)(text, true);
    for (const token of tokens) {
        const bucket = hash(token) % dimensions;
        const sign = (hash(`${token}:sign`) & 1) === 0 ? 1 : -1;
        vector[bucket] += sign;
        if (token.length > 3) {
            for (let index = 0; index < token.length - 2; index += 1) {
                const gram = token.slice(index, index + 3);
                const gramBucket = hash(`g:${gram}`) % dimensions;
                vector[gramBucket] += ((hash(`${gram}:s`) & 1) === 0 ? 1 : -1) * 0.35;
            }
        }
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
}
function cosineSimilarity(left, right) {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] * left[index];
        rightNorm += right[index] * right[index];
    }
    if (leftNorm === 0 || rightNorm === 0)
        return 0;
    return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}
