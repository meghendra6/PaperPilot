// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
const ALIASES = {
  ttft: ["time-to-first-token", "first-token-latency", "prefill-latency"],
  tpot: ["time-per-output-token", "inter-token-latency", "decode-latency"],
  itl: ["inter-token-latency", "time-per-output-token"],
  kv: ["key-value", "kv-cache", "cache"],
  llm: ["large-language-model", "language-model"],
  rag: ["retrieval-augmented-generation", "retrieval"],
  swa: ["sliding-window-attention", "window-attention"],
  sd: ["speculative-decoding", "draft-verification"],
  npu: ["neural-processing-unit", "accelerator"],
  gpu: ["graphics-processing-unit", "accelerator"],
};
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
  "및",
  "또는",
  "이",
  "그",
  "저",
  "것",
  "수",
  "를",
  "을",
  "에",
  "의",
  "가",
  "은",
  "는",
  "와",
  "과",
  "로",
  "으로",
  "에서",
  "한다",
  "했다",
]);
function normalize(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-");
}
function koreanNgrams(word) {
  const chars = [...word].filter((character) => /[가-힣]/.test(character));
  if (chars.length < 2) return chars;
  const result = [chars.join("")];
  for (let size = 2; size <= Math.min(3, chars.length); size += 1) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      result.push(chars.slice(index, index + size).join(""));
    }
  }
  return result;
}
function eastAsianNgrams(word) {
  const chars = [...word].filter((character) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character),
  );
  if (chars.length < 2) return chars;
  const result = [chars.join("")];
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.push(chars.slice(index, index + 2).join(""));
  }
  return result;
}
function tokenizeHybridOccurrences(text, expandAliases = true) {
  const normalized = normalize(String(text || ""));
  const raw =
    normalized.match(
      /\p{Script=Han}+|\p{Script=Hiragana}+|\p{Script=Katakana}+|[가-힣]+|[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu,
    ) ?? [];
  const tokens = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    if (/^[가-힣]+$/.test(token)) {
      tokens.push(...koreanNgrams(token));
    } else if (
      /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(token)
    ) {
      tokens.push(...eastAsianNgrams(token));
    } else {
      // Keep exact technical identifiers (for example qk_scale) while also
      // indexing a punctuation-normalized form for natural-language queries.
      tokens.push(token);
      const normalizedToken = token.replace(/[_.]/g, "-");
      if (normalizedToken !== token) tokens.push(normalizedToken);
    }
  }
  if (expandAliases) {
    const snapshot = [...tokens];
    for (const token of snapshot) {
      const aliases = ALIASES[token];
      if (aliases) tokens.push(...aliases);
      for (const [key, values] of Object.entries(ALIASES)) {
        if (values.includes(token))
          tokens.push(key, ...values.filter((value) => value !== token));
      }
    }
  }
  return tokens.filter((token) => token.length > 0);
}
function tokenizeHybrid(text, expandAliases = true) {
  return [...new Set(tokenizeHybridOccurrences(text, expandAliases))];
}
function queryPhrases(text) {
  const normalized = normalize(text).replace(/[^\p{L}\p{N}\s-]/gu, " ");
  const words = normalized.split(/\s+/).filter((word) => word.length > 1);
  const phrases = [];
  for (let size = 2; size <= Math.min(4, words.length); size += 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      phrases.push(words.slice(index, index + size).join(" "));
    }
  }
  return phrases;
}
/** Descriptive alias used by retrieval consumers. */

export {
  tokenizeHybrid,
  tokenizeHybridOccurrences,
  queryPhrases,
  tokenizeHybrid as tokenizeForRetrieval,
};
