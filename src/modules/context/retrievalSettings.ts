import { maxOverlapForChunkSize } from "../tools/splitTextIntoChunks";

// Chunk size and overlap are measured in characters of extracted paper text.
// The defaults match addon/prefs.js.
export const RETRIEVAL_CHUNK_SIZE_DEFAULT = 1200;
export const RETRIEVAL_CHUNK_SIZE_MIN = 200;
export const RETRIEVAL_CHUNK_SIZE_MAX = 100_000;
export const RETRIEVAL_OVERLAP_SIZE_DEFAULT = 200;

export interface RetrievalChunking {
  readonly chunkSize: number;
  readonly overlapSize: number;
  /** True when the saved chunk size is not the value Paper Pilot uses. */
  readonly chunkSizeAdjusted: boolean;
  /** True when the saved overlap is not the value Paper Pilot uses. */
  readonly overlapSizeAdjusted: boolean;
}

export interface RetrievalAdjustmentMessage {
  readonly l10nId: string;
  readonly args: Readonly<Record<string, number>>;
}

function toFiniteNumber(value: unknown) {
  if (value === undefined || value === null) return Number.NaN;
  if (typeof value === "string" && !value.trim()) return Number.NaN;
  return Number(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveChunkSize(raw: unknown) {
  const value = toFiniteNumber(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { value: RETRIEVAL_CHUNK_SIZE_DEFAULT, adjusted: true };
  }
  const resolved = clamp(
    Math.floor(value),
    RETRIEVAL_CHUNK_SIZE_MIN,
    RETRIEVAL_CHUNK_SIZE_MAX,
  );
  return { value: resolved, adjusted: resolved !== value };
}

function resolveOverlapSize(raw: unknown, chunkSize: number) {
  const maxOverlap = maxOverlapForChunkSize(chunkSize);
  const value = toFiniteNumber(raw);
  if (!Number.isFinite(value)) {
    const fallback = Math.min(RETRIEVAL_OVERLAP_SIZE_DEFAULT, maxOverlap);
    return { value: fallback, adjusted: true };
  }
  const resolved = clamp(Math.floor(value), 0, maxOverlap);
  return { value: resolved, adjusted: resolved !== value };
}

/**
 * Turns saved retrieval preferences into the chunking Paper Pilot actually
 * uses. Out-of-range values are clamped instead of rejected so a typo cannot
 * split a paper into one chunk per character.
 */
export function resolveRetrievalChunking(raw: {
  chunkSize: unknown;
  overlapSize: unknown;
}): RetrievalChunking {
  const chunkSize = resolveChunkSize(raw.chunkSize);
  const overlapSize = resolveOverlapSize(raw.overlapSize, chunkSize.value);
  return {
    chunkSize: chunkSize.value,
    overlapSize: overlapSize.value,
    chunkSizeAdjusted: chunkSize.adjusted,
    overlapSizeAdjusted: overlapSize.adjusted,
  };
}

/** Fluent messages that explain which saved values the settings pane adjusts. */
export function describeRetrievalChunking(resolved: RetrievalChunking): {
  chunkSize?: RetrievalAdjustmentMessage;
  overlapSize?: RetrievalAdjustmentMessage;
} {
  return {
    chunkSize: resolved.chunkSizeAdjusted
      ? {
          l10nId: "pref-retrieval-chunk-size-adjusted",
          args: {
            effective: resolved.chunkSize,
            min: RETRIEVAL_CHUNK_SIZE_MIN,
            max: RETRIEVAL_CHUNK_SIZE_MAX,
          },
        }
      : undefined,
    overlapSize: resolved.overlapSizeAdjusted
      ? {
          l10nId: "pref-retrieval-overlap-size-adjusted",
          args: {
            effective: resolved.overlapSize,
            max: maxOverlapForChunkSize(resolved.chunkSize),
          },
        }
      : undefined,
  };
}
