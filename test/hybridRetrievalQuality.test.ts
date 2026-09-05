import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fixture from "./fixtures/hybrid-retrieval.json";
import {
  buildHybridIndex,
  evaluateHybridRetrieval,
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
