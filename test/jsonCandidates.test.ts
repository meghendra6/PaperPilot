import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  extractJsonCandidates,
  parseFirstJsonObject,
  tryParseFirstJsonObject,
} from "../src/modules/ai/jsonCandidates";
import { parseCriticalReadOutput } from "../src/modules/criticalRead/parser";

test("shared JSON extraction ignores braces in strings and trailing prose", () => {
  const raw =
    'prefix {"summary":"A quoted } stays inside","nested":{"ok":true}} trailing prose }';
  assert.deepEqual(parseFirstJsonObject(raw), {
    summary: "A quoted } stays inside",
    nested: { ok: true },
  });
  assert.equal(extractJsonCandidates(raw).at(-1)?.endsWith("}}"), true);
});

test("shared JSON extraction tries later complete objects after invalid prose", () => {
  const parsed = tryParseFirstJsonObject(
    'noise {not-json} then {"accepted":true}',
    (value) =>
      (value as { accepted?: unknown }).accepted === true ? value : undefined,
  );
  assert.deepEqual(parsed, { accepted: true });
});

test("Critical Read accepts a complete object before trailing closing-brace prose", () => {
  const parsed = parseCriticalReadOutput(
    '{"summary":"Grounded summary","methodChecks":[],"provenance":[],"alternatives":[]} trailing }',
  );
  assert.equal(parsed.summary, "Grounded summary");
});
