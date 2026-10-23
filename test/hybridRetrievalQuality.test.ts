import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fixture from "./fixtures/hybrid-retrieval.json";
import {
  buildHybridIndex,
  evaluateHybridRetrieval,
  searchHybridIndex,
} from "../src/modules/researchWorkspace/core/context/hybrid/indexExports";

test("hybrid retrieval meets the labelled multilingual corpus quality floor", () => {
  const index = buildHybridIndex({
    documentKey: "retrieval-quality-v1",
    chunks: fixture.chunks,
  });
  const metrics = evaluateHybridRetrieval(index, fixture.cases, 3);
  const detail = JSON.stringify(metrics);
  assert(metrics.recallAtK >= 0.95, detail);
  assert(metrics.meanReciprocalRank >= 0.9, detail);
  assert(metrics.normalizedDiscountedCumulativeGain >= 0.9, detail);
});

test("hybrid search treats prototype names such as constructor as plain words", () => {
  const chunks = [
    { id: "intro", text: "We introduce the system and its motivation." },
    {
      id: "method",
      text: "The method relies on constructor injection for every service.",
    },
    { id: "related", text: "Prior work studies dependency graphs." },
  ];
  const built = buildHybridIndex({ documentKey: "proto", chunks });
  // A persisted index is plain JSON with Object.prototype keys.
  for (const index of [built, JSON.parse(JSON.stringify(built))]) {
    const results = searchHybridIndex(index, "constructor injection", {
      topK: 2,
    });
    assert.equal(results[0].chunk.id, "method");
    for (const result of results) {
      assert.ok(Number.isFinite(result.score.combined), result.chunk.id);
      if (result.chunk.id !== "method") {
        assert.ok(!result.matchedTerms.includes("constructor"));
      }
    }
  }
});
