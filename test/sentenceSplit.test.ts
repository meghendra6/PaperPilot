import { test } from "node:test";
import * as assert from "node:assert/strict";

import { splitSentences } from "../src/modules/researchWorkspace/sentenceSplit";

const texts = (value: string) =>
  splitSentences(value).map((slice) => slice.text.replace(/\s+/g, " ").trim());

test("hard-wrapped lines stay in one sentence and blank lines end paragraphs", () => {
  const value =
    "Prior work on sparse attention [1] reduced memory use, and\nlater studies [2] extended it.\n\nA heading without punctuation\n\nRecent results (Smith et al., 2019) show further gains in\nthroughput.";
  assert.deepEqual(texts(value), [
    "Prior work on sparse attention [1] reduced memory use, and later studies [2] extended it.",
    "A heading without punctuation",
    "Recent results (Smith et al., 2019) show further gains in throughput.",
  ]);
});

test("dots inside numbers, URLs, and abbreviations do not drop text", () => {
  assert.deepEqual(
    texts(
      "The cache reduces tail latency by 2.5 ms (e.g. for chat). Our code at github.com/x/y follows Lee [3].",
    ),
    [
      "The cache reduces tail latency by 2.5 ms (e.g. for chat).",
      "Our code at github.com/x/y follows Lee [3].",
    ],
  );
});

test("sentence offsets point into the original text", () => {
  const value = "First claim.\nSecond line of it.  Next one!";
  for (const slice of splitSentences(value)) {
    assert.equal(
      value.slice(slice.start, slice.start + slice.text.length),
      slice.text,
    );
  }
  assert.equal(splitSentences(value).length, 3);
});
