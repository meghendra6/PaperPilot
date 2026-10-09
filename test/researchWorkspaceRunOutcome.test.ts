import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRunOutcome,
  formatIncrementalProgress,
  summarizeRunOutcome,
} from "../src/modules/researchWorkspace/runOutcome";

const titles = new Map([
  ["zotero:1:A:PA", "Attention Is All You Need"],
  ["zotero:1:B:PB", "BERT"],
  ["zotero:1:C:PC", "GPT-3"],
  ["zotero:1:D:PD", "T5"],
]);

test("a run with failed units is reported as partial with paper titles", () => {
  const outcome = buildRunOutcome({
    checkpoint: {
      completedUnits: ["zotero:1:A:PA"],
      failedUnits: [
        { unitID: "zotero:1:B:PB" },
        { unitID: "zotero:1:C:PC" },
        { unitID: "zotero:1:D:PD" },
        { unitID: "zotero:1:E:PE" },
      ],
      pendingUnits: [],
    },
    total: 5,
    labelFor: (unitID) => titles.get(unitID),
  });
  assert.equal(outcome.status, "partial");
  const summary = summarizeRunOutcome("Evidence Matrix", outcome);
  assert.equal(summary.kind, "warning");
  assert.equal(summary.resumable, true);
  assert.match(summary.message, /^Evidence Matrix partial · 4 of 5 failed\./);
  assert.match(summary.message, /“BERT”, “GPT-3”, “T5” and 1 more/);
  assert.match(summary.message, /Resume/);
  assert.doesNotMatch(summary.message, /zotero:1:B/);
});

test("a fully completed run is a plain success", () => {
  const summary = summarizeRunOutcome(
    "Quick Compare",
    buildRunOutcome({
      checkpoint: {
        completedUnits: ["zotero:1:A:PA"],
        failedUnits: [],
        pendingUnits: [],
      },
      total: 1,
      labelFor: () => undefined,
    }),
  );
  assert.deepEqual(summary, {
    kind: "success",
    message: "Quick Compare saved to the project.",
    resumable: false,
  });
});

test("unrun units keep the run partial even without failures", () => {
  const summary = summarizeRunOutcome(
    "Evidence Matrix",
    buildRunOutcome({
      checkpoint: {
        completedUnits: [],
        failedUnits: [],
        pendingUnits: ["zotero:1:A:PA"],
      },
      total: 1,
      labelFor: () => undefined,
    }),
  );
  assert.match(summary.message, /^Evidence Matrix partial · 1 not run\./);
});

test("progress text names the paper instead of the internal source ID", () => {
  assert.equal(
    formatIncrementalProgress({
      title: "Evidence Matrix",
      completed: 2,
      total: 8,
      label: "BERT",
    }),
    "Evidence Matrix: 2/8 · BERT",
  );
});
