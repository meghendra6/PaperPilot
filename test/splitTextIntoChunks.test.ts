import { test } from "node:test";
import * as assert from "node:assert/strict";

import { splitTextIntoChunks } from "../src/modules/tools/splitTextIntoChunks";

test("splitTextIntoChunks caps overlap at half the chunk size", () => {
  assert.deepEqual(splitTextIntoChunks("abcdef", 3, 3), ["abc", "cde", "ef"]);
  assert.deepEqual(splitTextIntoChunks("abcdef", 3, 10), ["abc", "cde", "ef"]);
  assert.deepEqual(splitTextIntoChunks("abcdefgh", 4, 2), [
    "abcd",
    "cdef",
    "efgh",
  ]);
});

test("splitTextIntoChunks keeps the chunk count proportional to the text", () => {
  const text = "x".repeat(100_000);
  const chunks = splitTextIntoChunks(text, 1200, 99_999);
  assert.ok(chunks.length <= Math.ceil((2 * text.length) / 1200) + 1);
});

test("splitTextIntoChunks falls back for invalid chunk sizes", () => {
  const text = "x".repeat(1_100);
  assert.deepEqual(
    splitTextIntoChunks(text, 0, 0).map((part) => part.length),
    [1024, 76],
  );
  assert.deepEqual(
    splitTextIntoChunks(text, Number.NaN, 0).map((part) => part.length),
    [1024, 76],
  );
});

test("splitTextIntoChunks handles empty text and keeps the trailing chunk", () => {
  assert.deepEqual(splitTextIntoChunks("", 4, 1), []);
  assert.deepEqual(splitTextIntoChunks("abcdefghij", 4, 1), [
    "abcd",
    "defg",
    "ghij",
  ]);
});
