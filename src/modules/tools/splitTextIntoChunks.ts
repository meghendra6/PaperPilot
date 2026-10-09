/**
 * Largest overlap allowed for a chunk size. Capping overlap at half the chunk
 * keeps each step at least half a chunk, so the chunk count stays near
 * 2 × text length / chunk size instead of growing to one chunk per character.
 */
export function maxOverlapForChunkSize(chunkSize: number) {
  return Math.floor(chunkSize / 2);
}

export function splitTextIntoChunks(
  text: string,
  chunkSize: number = 1024,
  overlapSize: number = 200,
): string[] {
  if (!text) {
    return [];
  }

  const resolvedChunkSize =
    Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 1024;
  const resolvedOverlapSize =
    Number.isFinite(overlapSize) && overlapSize > 0
      ? Math.min(
          Math.floor(overlapSize),
          maxOverlapForChunkSize(resolvedChunkSize),
        )
      : 0;
  const step = Math.max(1, resolvedChunkSize - resolvedOverlapSize);
  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + resolvedChunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);
    chunks.push(chunk);
    if (endIndex === text.length) {
      break;
    }
    startIndex += step;
  }

  return chunks;
}
