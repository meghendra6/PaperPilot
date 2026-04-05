import { test } from "node:test";
import * as assert from "node:assert/strict";

import { parseHighlightCandidatesWithRepair } from "../src/modules/autoHighlight/response";

test("parseHighlightCandidatesWithRepair repairs prose-only responses via retry", async () => {
  const seenStatuses: string[] = [];
  let requestCount = 0;

  const repaired = await parseHighlightCandidatesWithRepair({
    itemID: 1,
    title: "Paper",
    rawResponse: "Here are the key passages:\n1. First one\n2. Second one",
    onStatus: (status) => seenStatuses.push(status),
    requestText: async () => {
      requestCount += 1;
      return JSON.stringify({
        highlights: [{ quote: "Exact repaired quote", reason: "important" }],
      });
    },
  });

  assert.equal(requestCount, 1);
  assert.deepEqual(seenStatuses, ["Repairing Codex response…"]);
  assert.deepEqual(repaired, [
    { quote: "Exact repaired quote", reason: "important" },
  ]);
});
