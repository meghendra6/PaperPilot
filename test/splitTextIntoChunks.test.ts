import { test } from "node:test";
import * as assert from "node:assert/strict";

import { splitTextIntoChunks } from "../src/modules/tools/splitTextIntoChunks";

test("splitTextIntoChunks terminates when overlap equals or exceeds chunk size", () => {
  assert.deepEqual(splitTextIntoChunks("abcdef", 3, 3), [
    "abc",
    "bcd",
    "cde",
    "def",
  ]);
  assert.deepEqual(splitTextIntoChunks("abcdef", 3, 10), [
    "abc",
    "bcd",
    "cde",
    "def",
  ]);
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
