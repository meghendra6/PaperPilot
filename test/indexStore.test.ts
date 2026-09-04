import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildPaperIndexKey,
  clearIndexedChunks,
  getIndexedChunks,
} from "../src/modules/context/indexStore";

test("paper chunk indexes are library scoped, bounded, and clearable", () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  const store = new Map<string, { hash: string; chunks: string[] }>();
  (globalThis as { addon?: unknown }).addon = {
    data: { paperIndexStore: store },
  };
  try {
    for (let libraryID = 1; libraryID <= 14; libraryID += 1) {
      getIndexedChunks({
        libraryID,
        itemKey: "SAME",
        text: `paper ${libraryID}`,
        chunkSize: 20,
        overlapSize: 0,
      });
    }
    assert.equal(store.size, 12);
    assert.equal(store.has(buildPaperIndexKey(1, "SAME")), false);
    assert.equal(store.has(buildPaperIndexKey(2, "SAME")), false);
    assert.equal(store.has(buildPaperIndexKey(14, "SAME")), true);

    clearIndexedChunks({ libraryID: 14, itemKey: "SAME" });
    assert.equal(store.has(buildPaperIndexKey(14, "SAME")), false);
  } finally {
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});
