import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as corpus from "./fixtures/chat-evaluation/corpus.json";

test("evaluation corpus has thirty licensed scenarios and exact source-scoped expected quotes", () => {
  assert.equal(corpus.license, "CC0-1.0");
  assert.equal(corpus.fixtures.length, 30);
  assert.equal(new Set(corpus.fixtures.map((fixture) => fixture.id)).size, 30);
  assert.deepEqual(
    Object.fromEntries(
      [
        "selection",
        "followup",
        "annotation",
        "visual",
        "comparison",
        "insufficient",
      ].map((scenario) => [
        scenario,
        corpus.fixtures.filter((fixture) => fixture.scenario === scenario)
          .length,
      ]),
    ),
    {
      selection: 8,
      followup: 6,
      annotation: 4,
      visual: 4,
      comparison: 4,
      insufficient: 4,
    },
  );
  for (const fixture of corpus.fixtures) {
    assert.ok(fixture.expectedLimit);
    assert.equal(fixture.imageSupplied, false);
    for (const expected of fixture.expectedQuotes) {
      assert.ok(fixture.sourceIDs.includes(expected.sourceID));
      assert.ok(
        corpus.sources
          .find((source) => source.sourceID === expected.sourceID)
          ?.text.includes(expected.quote),
        `${fixture.id}: exact expected quote`,
      );
      assert.equal(expected.pageIndex, 0);
    }
  }
});
