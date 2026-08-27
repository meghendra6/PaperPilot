// @ts-nocheck -- Ported feature core is guarded by strict runtime parsers.
import * as hashEmbedding_1 from "./hashEmbedding";
import * as tokenizer_1 from "./tokenizer";
function buildHybridIndex(params) {
  const dimensions = Math.max(
    32,
    Math.min(1024, Math.floor(params.embeddingDimensions ?? 192)),
  );
  const chunks = params.chunks
    .filter(
      (chunk) =>
        chunk &&
        typeof chunk.id === "string" &&
        typeof chunk.text === "string" &&
        chunk.text.trim(),
    )
    .map((chunk) => {
      const tokens = (0, tokenizer_1.tokenizeHybridOccurrences)(
        `${chunk.title || ""}\n${chunk.text}`,
        true,
      );
      const termFrequency = {};
      for (const token of tokens)
        termFrequency[token] = (termFrequency[token] ?? 0) + 1;
      return {
        ...chunk,
        text: chunk.text.trim(),
        tokens,
        termFrequency,
        embedding: (0, hashEmbedding_1.createHashEmbedding)(
          `${chunk.title || ""}\n${chunk.text}`,
          dimensions,
        ),
        length: Math.max(1, tokens.length),
      };
    });
  const documentFrequency = {};
  for (const chunk of chunks) {
    for (const token of new Set(chunk.tokens))
      documentFrequency[token] = (documentFrequency[token] ?? 0) + 1;
  }
  const averageDocumentLength = chunks.length
    ? chunks.reduce((sum, chunk) => sum + chunk.length, 0) / chunks.length
    : 0;
  return {
    schemaVersion: 1,
    documentKey: String(
      params.documentKey ||
        [params.paperKey, params.attachmentKey, params.sourceFingerprint]
          .filter(Boolean)
          .join(":") ||
        "document",
    ),
    createdAt: params.now ?? new Date().toISOString(),
    chunks,
    documentFrequency,
    averageDocumentLength,
    embeddingDimensions: dimensions,
  };
}
function chunkTextForHybridIndex(text, options = {}) {
  const chunkSize = Math.max(300, Math.floor(options.chunkSize ?? 1400));
  const overlap = Math.max(
    0,
    Math.min(chunkSize - 1, Math.floor(options.overlap ?? 220)),
  );
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) return [];
  const result = [];
  let offset = 0;
  let index = 0;
  while (offset < normalized.length) {
    let end = Math.min(normalized.length, offset + chunkSize);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf(". ", end),
      );
      if (boundary > offset + chunkSize * 0.55) end = boundary + 1;
    }
    const value = normalized.slice(offset, end).trim();
    if (value)
      result.push({
        id: `chunk-${index}`,
        text: value,
        attachmentKey: options.attachmentKey,
      });
    if (end >= normalized.length) break;
    offset = Math.max(offset + 1, end - overlap);
    index += 1;
  }
  return result;
}
/**
 * Section-aware convenience wrapper for indexing a paper. It keeps headings on
 * every generated chunk so section-aware ranking remains available even when
 * the source extractor only produced Markdown/plain text.
 */
function chunkPaperDocument(params) {
  const chunks = chunkTextForHybridIndex(params.text, {
    chunkSize: params.targetCharacters,
    overlap: params.overlapCharacters,
    attachmentKey: params.attachmentKey,
  });
  let currentSection;
  return chunks.map((chunk, ordinal) => {
    const headings = [...chunk.text.matchAll(/^#{1,6}\s+(.+)$/gm)];
    if (headings.length)
      currentSection = headings[headings.length - 1][1].trim();
    return {
      ...chunk,
      id: `${params.paperKey}:${params.attachmentKey}:${ordinal}`,
      title: currentSection,
      sectionPath: currentSection ? [currentSection] : undefined,
      metadata: { paperKey: params.paperKey, ordinal },
    };
  });
}

export { buildHybridIndex, chunkTextForHybridIndex, chunkPaperDocument };
