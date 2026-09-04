// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as hashEmbedding_1 from "./hashEmbedding";
import * as tokenizer_1 from "./tokenizer";
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function bm25(index, chunkIndex, queryTokens) {
  const chunk = index.chunks[chunkIndex];
  const count = Math.max(1, index.chunks.length);
  const averageLength = Math.max(1, index.averageDocumentLength);
  const k1 = 1.35;
  const b = 0.72;
  let score = 0;
  const matched = [];
  for (const token of queryTokens) {
    const frequency = chunk.termFrequency[token] ?? 0;
    if (!frequency) continue;
    matched.push(token);
    const df = index.documentFrequency[token] ?? 0;
    const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5));
    score +=
      idf *
      ((frequency * (k1 + 1)) /
        (frequency + k1 * (1 - b + (b * chunk.length) / averageLength)));
  }
  return { value: score, matched };
}
function searchHybridIndex(index, query, options = {}) {
  const topK = Math.max(
    1,
    Math.min(index.chunks.length || 1, Math.floor(options.topK ?? 5)),
  );
  if (!query.trim() || index.chunks.length === 0) return [];
  const queryTokens = (0, tokenizer_1.tokenizeHybrid)(query);
  const queryEmbedding = (0, hashEmbedding_1.createHashEmbedding)(
    query,
    index.embeddingDimensions,
  );
  const phrases = (0, tokenizer_1.queryPhrases)(query);
  const preferred = (
    options.preferredSections ??
    options.sectionHints ??
    []
  ).map((value) => value.toLowerCase());
  const weights = {
    lexical: options.lexicalWeight ?? 0.38,
    semantic: options.semanticWeight ?? 0.34,
    title: options.titleWeight ?? 0.11,
    exact: options.exactWeight ?? 0.1,
    section: options.sectionWeight ?? 0.07,
  };
  const raw = index.chunks
    .map((chunk, chunkIndex) => {
      const lexical = bm25(index, chunkIndex, queryTokens);
      const semantic =
        ((0, hashEmbedding_1.cosineSimilarity)(
          queryEmbedding,
          chunk.embedding,
        ) +
          1) /
        2;
      const titleTokens = new Set(chunk.titleTokens || []);
      const title = queryTokens.length
        ? queryTokens.filter((token) => titleTokens.has(token)).length /
          queryTokens.length
        : 0;
      const textLower = chunk.searchText;
      const exact = phrases.length
        ? Math.max(
            ...phrases.map((phrase) => (textLower.includes(phrase) ? 1 : 0)),
            0,
          )
        : 0;
      const sectionText =
        `${chunk.title || ""} ${(chunk.sectionPath || []).join(" ")}`.toLowerCase();
      const section = preferred.length
        ? preferred.some((value) => sectionText.includes(value))
          ? 1
          : 0
        : 0;
      const lexicalNormalized =
        1 - Math.exp(-lexical.value / Math.max(1, queryTokens.length * 0.8));
      const combined = clamp01(
        weights.lexical * lexicalNormalized +
          weights.semantic * semantic +
          weights.title * title +
          weights.exact * exact +
          weights.section * section,
      );
      return {
        chunk: {
          id: chunk.id,
          text: chunk.text,
          title: chunk.title,
          pageIndex: chunk.pageIndex,
          sectionPath: chunk.sectionPath,
          attachmentKey: chunk.attachmentKey,
          metadata: chunk.metadata,
        },
        score: {
          lexical: lexicalNormalized,
          semantic,
          title,
          exact,
          section,
          combined,
          diversityPenalty: 0,
        },
        matchedTerms: lexical.matched,
        rank: 0,
        embedding: chunk.embedding,
      };
    })
    .sort((left, right) => right.score.combined - left.score.combined);
  const candidateLimit = Math.min(
    raw.length,
    Math.max(topK, topK * Math.floor(options.candidateMultiplier ?? 5)),
  );
  const candidates = raw.slice(0, candidateLimit);
  const selected = [];
  const lambda = clamp01(options.mmrLambda ?? 0.82);
  while (selected.length < topK && candidates.length) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let indexValue = 0; indexValue < candidates.length; indexValue += 1) {
      const candidate = candidates[indexValue];
      const similarity = selected.length
        ? Math.max(
            ...selected.map((entry) =>
              Math.max(
                0,
                (0, hashEmbedding_1.cosineSimilarity)(
                  candidate.embedding,
                  entry.embedding,
                ),
              ),
            ),
          )
        : 0;
      const value =
        lambda * candidate.score.combined - (1 - lambda) * similarity;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = indexValue;
      }
    }
    const [chosen] = candidates.splice(bestIndex, 1);
    const diversityPenalty = selected.length
      ? Math.max(
          ...selected.map((entry) =>
            Math.max(
              0,
              (0, hashEmbedding_1.cosineSimilarity)(
                chosen.embedding,
                entry.embedding,
              ),
            ),
          ),
        )
      : 0;
    chosen.score.diversityPenalty = diversityPenalty;
    selected.push(chosen);
  }
  return selected.map((entry, indexValue) => ({
    chunk: entry.chunk,
    score: entry.score,
    matchedTerms: entry.matchedTerms,
    rank: indexValue + 1,
  }));
}

export { searchHybridIndex };
