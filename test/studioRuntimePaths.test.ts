import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertRuntimeSnapshotPaths } from "../src/modules/studio/documentIdentity";

test("runtime snapshots reject case and Unicode aliases before materialization", () => {
  for (const names of [
    ["data.csv", "Data.csv"],
    ["figures/plot.png", "Figures/PLOT.png"],
    ["caf\u00e9.csv", "cafe\u0301.csv"],
    ["\uAC00.csv", "\u1100\u1161.csv"],
  ]) {
    assert.throws(
      () => assertRuntimeSnapshotPaths(names),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(names[0]) &&
        error.message.includes(names[1]),
    );
  }
});

test("runtime snapshots reject file/folder collisions in either input order", () => {
  for (const names of [
    ["data", "data/table.csv"],
    ["Data/table.csv", "data"],
    ["analysis/input", "Analysis/Input/nested/value.txt"],
  ])
    assert.throws(() => assertRuntimeSnapshotPaths(names), /also a folder/);
});

test("runtime snapshots retain distinct names and reject invalid relative paths", () => {
  assert.doesNotThrow(() =>
    assertRuntimeSnapshotPaths([
      "data/input.csv",
      "data/inputs.csv",
      "data-table.csv",
      "\uC6D0\uACE0/draft.typ",
    ]),
  );
  assert.doesNotThrow(() => assertRuntimeSnapshotPaths([]));
  assert.throws(() => assertRuntimeSnapshotPaths(["../outside.csv"]));
});
