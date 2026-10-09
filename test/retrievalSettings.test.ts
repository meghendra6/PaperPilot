import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  RETRIEVAL_CHUNK_SIZE_DEFAULT,
  RETRIEVAL_CHUNK_SIZE_MAX,
  RETRIEVAL_CHUNK_SIZE_MIN,
  RETRIEVAL_OVERLAP_SIZE_DEFAULT,
  describeRetrievalChunking,
  resolveRetrievalChunking,
} from "../src/modules/context/retrievalSettings";
import { splitTextIntoChunks } from "../src/modules/tools/splitTextIntoChunks";

test("retrieval chunking keeps valid saved values unchanged", () => {
  assert.deepEqual(
    resolveRetrievalChunking({ chunkSize: 1200, overlapSize: 200 }),
    {
      chunkSize: 1200,
      overlapSize: 200,
      chunkSizeAdjusted: false,
      overlapSizeAdjusted: false,
    },
  );
  assert.deepEqual(
    resolveRetrievalChunking({ chunkSize: "800", overlapSize: "400" }),
    {
      chunkSize: 800,
      overlapSize: 400,
      chunkSizeAdjusted: false,
      overlapSizeAdjusted: false,
    },
  );
});

test("retrieval chunking honors a saved overlap of zero", () => {
  const resolved = resolveRetrievalChunking({
    chunkSize: 1200,
    overlapSize: 0,
  });
  assert.equal(resolved.overlapSize, 0);
  assert.equal(resolved.overlapSizeAdjusted, false);
});

test("retrieval chunking clamps overlap to half the chunk size", () => {
  const resolved = resolveRetrievalChunking({
    chunkSize: 1200,
    overlapSize: 99_999,
  });
  assert.equal(resolved.chunkSize, 1200);
  assert.equal(resolved.overlapSize, 600);
  assert.equal(resolved.overlapSizeAdjusted, true);

  const equal = resolveRetrievalChunking({ chunkSize: 900, overlapSize: 900 });
  assert.equal(equal.overlapSize, 450);
  assert.equal(equal.overlapSizeAdjusted, true);

  const negative = resolveRetrievalChunking({
    chunkSize: 1200,
    overlapSize: -5,
  });
  assert.equal(negative.overlapSize, 0);
  assert.equal(negative.overlapSizeAdjusted, true);
});

test("retrieval chunking clamps chunk size to the supported range", () => {
  const tiny = resolveRetrievalChunking({ chunkSize: 1, overlapSize: 0 });
  assert.equal(tiny.chunkSize, RETRIEVAL_CHUNK_SIZE_MIN);
  assert.equal(tiny.chunkSizeAdjusted, true);

  const huge = resolveRetrievalChunking({ chunkSize: 250_000, overlapSize: 0 });
  assert.equal(huge.chunkSize, RETRIEVAL_CHUNK_SIZE_MAX);
  assert.equal(huge.chunkSizeAdjusted, true);
});

test("retrieval chunking falls back to defaults for missing or invalid values", () => {
  for (const chunkSize of [undefined, "", 0, Number.NaN, "abc"]) {
    const resolved = resolveRetrievalChunking({
      chunkSize,
      overlapSize: undefined,
    });
    assert.equal(resolved.chunkSize, RETRIEVAL_CHUNK_SIZE_DEFAULT);
    assert.equal(resolved.overlapSize, RETRIEVAL_OVERLAP_SIZE_DEFAULT);
    assert.equal(resolved.chunkSizeAdjusted, true);
  }
});

test("a 100k-character paper stays bounded with extreme saved settings", () => {
  const text = "x".repeat(100_000);
  const resolved = resolveRetrievalChunking({
    chunkSize: 1,
    overlapSize: 99_999,
  });
  const chunks = splitTextIntoChunks(
    text,
    resolved.chunkSize,
    resolved.overlapSize,
  );
  const maxChunks = Math.ceil((2 * text.length) / resolved.chunkSize) + 1;
  assert.ok(
    chunks.length <= maxChunks,
    `expected at most ${maxChunks} chunks, got ${chunks.length}`,
  );
});

test("describeRetrievalChunking explains each adjusted value", () => {
  assert.deepEqual(
    describeRetrievalChunking(
      resolveRetrievalChunking({ chunkSize: 1200, overlapSize: 200 }),
    ),
    { chunkSize: undefined, overlapSize: undefined },
  );
  assert.deepEqual(
    describeRetrievalChunking(
      resolveRetrievalChunking({ chunkSize: 50, overlapSize: 5000 }),
    ),
    {
      chunkSize: {
        l10nId: "pref-retrieval-chunk-size-adjusted",
        args: {
          effective: RETRIEVAL_CHUNK_SIZE_MIN,
          min: RETRIEVAL_CHUNK_SIZE_MIN,
          max: RETRIEVAL_CHUNK_SIZE_MAX,
        },
      },
      overlapSize: {
        l10nId: "pref-retrieval-overlap-size-adjusted",
        args: {
          effective: RETRIEVAL_CHUNK_SIZE_MIN / 2,
          max: RETRIEVAL_CHUNK_SIZE_MIN / 2,
        },
      },
    },
  );
});
