import * as assert from "node:assert/strict";
import { test } from "node:test";
import { planResearchWorkspaceSelectionOffer } from "../src/modules/researchWorkspace/selectionOffer";
import type { ResearchWorkspaceSelectionCandidate } from "../src/modules/researchWorkspace/selectionSnapshot";

function candidate(key: string): ResearchWorkspaceSelectionCandidate {
  return {
    selectedIndex: 0,
    selectedItemID: 1,
    sourceID: `zotero:1:${key}:P${key}`,
    libraryID: 1,
    itemID: 1,
    itemKey: key,
    attachmentID: 2,
    attachmentKey: `P${key}`,
    title: `Paper ${key}`,
  };
}

function snapshot(keys: string[], skipped = 0) {
  return {
    candidates: keys.map(candidate),
    skipped: Array.from({ length: skipped }, (_, index) => ({
      selectedIndex: index,
      title: "Skipped",
      code: "no-pdf" as const,
      reason: "No PDF attachment.",
    })),
  };
}

test("a relaunch with a new selection offers use, add, and dismiss choices", () => {
  const offer = planResearchWorkspaceSelectionOffer({
    current: snapshot(["A"]),
    next: snapshot(["B", "C"], 1),
    currentProjectName: "Survey",
  });
  assert.ok(offer);
  assert.equal(offer.count, 2);
  assert.equal(offer.useLabel, "Use these 2 papers");
  assert.equal(offer.addLabel, "Add to “Survey”");
  assert.deepEqual(offer.titles, ["Paper B", "Paper C"]);
  assert.match(offer.message, /2 papers with a readable PDF \(1 skipped\)/);
  assert.match(offer.message, /current view stays/);
});

test("adding is only offered while a project is open", () => {
  const offer = planResearchWorkspaceSelectionOffer({ next: snapshot(["B"]) });
  assert.equal(offer?.useLabel, "Use this paper");
  assert.equal(offer?.addLabel, undefined);
});

test("an empty or unchanged selection only focuses the window", () => {
  assert.equal(
    planResearchWorkspaceSelectionOffer({ next: snapshot([]) }),
    undefined,
  );
  assert.equal(
    planResearchWorkspaceSelectionOffer({
      current: snapshot(["A", "B"]),
      next: snapshot(["B", "A"]),
    }),
    undefined,
  );
});
