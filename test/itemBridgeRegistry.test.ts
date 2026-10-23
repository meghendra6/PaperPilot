import * as assert from "node:assert/strict";
import { test } from "node:test";
import { registerItemBridge } from "../src/modules/ui/itemBridgeRegistry";
import { pruneReaderPaneItemState } from "../src/modules/readerPane";

test("closing the newest pane of a paper hands its bridge back to the older pane", () => {
  const bridges = new Map<number, string>();
  const unregisterFirst = registerItemBridge(bridges, 7, "first tab");
  const unregisterSecond = registerItemBridge(bridges, 7, "second tab");
  assert.equal(bridges.get(7), "second tab");

  unregisterSecond();
  assert.equal(bridges.get(7), "first tab");
  unregisterSecond();
  assert.equal(bridges.get(7), "first tab");

  unregisterFirst();
  assert.equal(bridges.has(7), false);
});

test("closing an older pane keeps the newest pane's bridge", () => {
  const bridges = new Map<number, string>();
  const unregisterFirst = registerItemBridge(bridges, 8, "first tab");
  registerItemBridge(bridges, 8, "second tab");
  unregisterFirst();
  assert.equal(bridges.get(8), "second tab");
});

test("tab-close pruning keeps the paper's session-derived workflow state", () => {
  const globals = globalThis as typeof globalThis & {
    addon?: unknown;
    Zotero?: unknown;
  };
  const previousAddon = globals.addon;
  const previousZotero = globals.Zotero;
  const keep = () => new Map([[42, { saved: true }]]);
  const data = {
    modeOverrides: new Map([[42, "claude_code"]]),
    relatedRecommendationStates: keep(),
    autoHighlightStates: keep(),
    paperArtifactStates: keep(),
    comprehensionCheckStates: keep(),
    criticalReadStates: keep(),
    pendingReaderActions: keep(),
    pendingDiscoveryConcerns: keep(),
    readerActionDrafts: keep(),
  };
  globals.addon = { data };
  (globalThis as Record<string, unknown>).Zotero = {
    Items: { get: () => undefined },
  };
  try {
    pruneReaderPaneItemState(42);
    for (const name of [
      "modeOverrides",
      "relatedRecommendationStates",
      "autoHighlightStates",
      "paperArtifactStates",
      "comprehensionCheckStates",
      "criticalReadStates",
    ] as const) {
      assert.equal(data[name].has(42), true, `${name} must survive`);
    }
    for (const name of [
      "pendingReaderActions",
      "pendingDiscoveryConcerns",
      "readerActionDrafts",
    ] as const) {
      assert.equal(data[name].has(42), false, `${name} is transient`);
    }
  } finally {
    globals.addon = previousAddon;
    globals.Zotero = previousZotero;
  }
});
