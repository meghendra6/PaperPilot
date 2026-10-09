import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearCriticalReadViewState,
  getCriticalReadDraft,
  getExpandedCriticalReadSteps,
  hasUnsentCriticalReadDraft,
  pruneCriticalReadDrafts,
  setCriticalReadDraft,
  setCriticalReadStepExpanded,
} from "../src/modules/ui/criticalReadDraft";

test("Critical Read drafts are isolated by paper, session, and step", () => {
  clearCriticalReadViewState();
  setCriticalReadDraft(1, "session-a", 2, "Paper one, step two");
  setCriticalReadDraft(1, "session-a", 4, "Paper one, step four");
  setCriticalReadDraft(2, "session-a", 2, "Paper two");
  setCriticalReadDraft(1, "session-b", 2, "Another session");

  assert.equal(getCriticalReadDraft(1, "session-a", 2), "Paper one, step two");
  assert.equal(getCriticalReadDraft(1, "session-a", 4), "Paper one, step four");
  assert.equal(getCriticalReadDraft(2, "session-a", 2), "Paper two");
  assert.equal(getCriticalReadDraft(1, "session-b", 2), "Another session");
  assert.equal(getCriticalReadDraft(1, "session-a", 5), undefined);
});

test("an emptied draft is kept so it does not fall back to saved input", () => {
  clearCriticalReadViewState();
  setCriticalReadDraft(1, "s", 1, "typed");
  setCriticalReadDraft(1, "s", 1, "");
  assert.equal(getCriticalReadDraft(1, "s", 1), "");
  assert.equal(hasUnsentCriticalReadDraft(1, "s"), false);
});

test("completed steps drop their drafts while unsent steps keep them", () => {
  clearCriticalReadViewState();
  setCriticalReadDraft(1, "s", 1, "saved by completion");
  setCriticalReadDraft(1, "s", 2, "still unsent");
  pruneCriticalReadDrafts(1, "s", [1]);
  assert.equal(getCriticalReadDraft(1, "s", 1), undefined);
  assert.equal(getCriticalReadDraft(1, "s", 2), "still unsent");
  assert.equal(hasUnsentCriticalReadDraft(1, "s"), true);
});

test("expanded completed steps survive rebuilds and clear per paper", () => {
  clearCriticalReadViewState();
  setCriticalReadStepExpanded(1, "s", 3, true);
  setCriticalReadStepExpanded(1, "s", 1, true);
  setCriticalReadStepExpanded(1, "s", 3, false);
  setCriticalReadStepExpanded(2, "s", 5, true);
  assert.deepEqual(getExpandedCriticalReadSteps(1, "s"), [1]);

  clearCriticalReadViewState(1);
  assert.deepEqual(getExpandedCriticalReadSteps(1, "s"), []);
  assert.deepEqual(getExpandedCriticalReadSteps(2, "s"), [5]);
});
