import { splitTextIntoChunks } from "../tools/splitTextIntoChunks";

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreChunk(chunk: string, queryTokens: string[]) {
  const lower = chunk.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export function selectRelevantChunks(params: {
  text: string;
  query: string;
  chunkSize?: number;
  overlapSize?: number;
  topK?: number;
}) {
  const chunks = splitTextIntoChunks(
    params.text,
    params.chunkSize ?? 1100,
    params.overlapSize ?? 200,
  );
  return selectRelevantChunksFromChunks(chunks, params.query, params.topK ?? 5);
}

export function selectRelevantChunksFromChunks(
  chunks: string[],
  query: string,
  topK: number,
) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return chunks.slice(0, topK);
  }

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.chunk);
}
