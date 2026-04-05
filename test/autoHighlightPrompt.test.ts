import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildAutoHighlightQuestion,
  buildAutoHighlightRepairQuestion,
  parseAutoHighlightResponse,
} from "../src/modules/autoHighlight/prompt";

test("buildAutoHighlightQuestion requests strict JSON exact quotes", () => {
  const prompt = buildAutoHighlightQuestion();
  assert.match(prompt, /strict JSON only/i);
  assert.match(prompt, /quote must be verbatim/i);
  assert.match(prompt, /at most 5 highlights/i);
  assert.match(prompt, /reason short and evidence-based/i);
  assert.match(
    prompt,
    /omit any candidate unless you are confident it appears exactly in paper\.txt/i,
  );
});

test("buildAutoHighlightRepairQuestion falls back to an empty highlight list when quotes are unusable", () => {
  const prompt = buildAutoHighlightRepairQuestion("No exact quotes found.", 3);

  assert.match(prompt, /ONLY a single strict JSON object/i);
  assert.match(prompt, /Keep at most 3 highlights\./i);
  assert.match(prompt, /output \{"highlights":\[\]\}/i);
});

test("parseAutoHighlightResponse parses valid highlight JSON", () => {
  assert.deepEqual(
    parseAutoHighlightResponse(
      JSON.stringify({
        highlights: [
          { quote: "Exact passage", reason: "important", importance: 0.9 },
        ],
      }),
    ),
    [{ quote: "Exact passage", reason: "important", importance: 0.9 }],
  );
});

test("parseAutoHighlightResponse strips fenced JSON and clamps count", () => {
  const parsed = parseAutoHighlightResponse(
    `\`\`\`json\n${JSON.stringify({
      highlights: Array.from({ length: 7 }, (_, index) => ({
        quote: `Quote ${index}`,
      })),
    })}\n\`\`\``,
  );
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].quote, "Quote 0");
});

test("parseAutoHighlightResponse extracts embedded JSON from prose", () => {
  const parsed = parseAutoHighlightResponse(
    `Here is the result:\n${JSON.stringify({
      highlights: [{ quote: "Embedded quote", reason: "important" }],
    })}\nUse it carefully.`,
  );
  assert.deepEqual(parsed, [{ quote: "Embedded quote", reason: "important" }]);
});

test("parseAutoHighlightResponse rejects malformed JSON", () => {
  assert.throws(
    () => parseAutoHighlightResponse("not json"),
    /invalid highlight JSON/i,
  );
});

test("parseAutoHighlightResponse reports empty highlights clearly", () => {
  assert.throws(
    () => parseAutoHighlightResponse('{"highlights":[]}'),
    /did not return any usable exact quotes/i,
  );
});
