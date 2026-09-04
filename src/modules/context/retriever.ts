import { splitTextIntoChunks } from "../tools/splitTextIntoChunks";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "이",
  "그",
  "를",
  "을",
  "에",
  "의",
]);

function characterBigrams(value: string) {
  const characters = [...value];
  if (characters.length < 2) return characters;
  return characters
    .slice(0, -1)
    .map((character, index) => [character, characters[index + 1]].join(""));
}

export function tokenizeRetrievalText(value: string) {
  const normalized =
    value
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .normalize("NFKC")
      .toLowerCase()
      .match(
        /\p{Script=Han}+|\p{Script=Hiragana}+|\p{Script=Katakana}+|[가-힣]+|[\p{L}\p{N}]+/gu,
      ) ?? [];
  return normalized.flatMap((token) => {
    if (STOPWORDS.has(token)) return [];
    if (
      /^[가-힣]+$/.test(token) ||
      /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(token)
    ) {
      return characterBigrams(token);
    }
    return token.length > 1 ? [token] : [];
  });
}

function scoreChunk(chunk: string, queryTokens: string[]) {
  const frequencies = new Map<string, number>();
  for (const token of tokenizeRetrievalText(chunk)) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return queryTokens.reduce(
    (score, token) => score + (frequencies.get(token) ?? 0),
    0,
  );
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
  const queryTokens = tokenizeRetrievalText(query);
  if (!queryTokens.length) {
    return query.trim() ? [] : chunks.slice(0, topK);
  }

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.chunk);
}
