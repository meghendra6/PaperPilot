import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClearCardsConfirmation,
  formatClearedCardsStatus,
  getWorkbenchActionBlock,
  WORKBENCH_WAIT_FOR_ANSWER,
  WORKBENCH_WAIT_FOR_DISCOVERY,
  WORKBENCH_WAIT_FOR_HIGHLIGHTING,
} from "../src/modules/ui/workbenchAvailability";
import {
  AUTO_HIGHLIGHT_CANCELLED_STATUS,
  getAutoHighlightButtonPresentation,
} from "../src/modules/autoHighlight/status";

test("Workbench requests are blocked with a reason while the chat answer runs", () => {
  assert.deepEqual(
    getWorkbenchActionBlock({ ownRunActive: false, readerBusy: true }),
    { blocked: true, reason: WORKBENCH_WAIT_FOR_ANSWER },
  );
  assert.equal(
    WORKBENCH_WAIT_FOR_ANSWER,
    "Wait for the current answer to finish.",
  );
  assert.deepEqual(
    getWorkbenchActionBlock({ ownRunActive: false, readerBusy: false }),
    { blocked: false },
  );
});

test("Workbench names the task that holds the paper", () => {
  assert.deepEqual(
    getWorkbenchActionBlock({
      ownRunActive: false,
      readerBusy: true,
      discoveryRunning: true,
    }),
    { blocked: true, reason: WORKBENCH_WAIT_FOR_DISCOVERY },
  );
  assert.deepEqual(
    getWorkbenchActionBlock({
      ownRunActive: false,
      readerBusy: true,
      highlightRunning: true,
    }),
    { blocked: true, reason: WORKBENCH_WAIT_FOR_HIGHLIGHTING },
  );
});

test("stale task flags do not block Workbench once the paper is free", () => {
  assert.deepEqual(
    getWorkbenchActionBlock({
      ownRunActive: false,
      readerBusy: false,
      discoveryRunning: true,
      highlightRunning: true,
    }),
    { blocked: false },
  );
});

test("the Workbench's own run keeps its progress status", () => {
  assert.deepEqual(
    getWorkbenchActionBlock({ ownRunActive: true, readerBusy: true }),
    { blocked: true },
  );
});

test("Clear cards confirms with a count and reports what it removed", () => {
  assert.equal(formatClearedCardsStatus(1), "Cleared 1 card");
  assert.equal(formatClearedCardsStatus(3), "Cleared 3 cards");
  const confirmation = buildClearCardsConfirmation(2);
  assert.equal(confirmation.title, "Clear Workbench cards?");
  assert.match(confirmation.message, /removes 2 cards/);
  assert.match(confirmation.message, /cannot undo/);
});

test("Highlight key passages turns into a cancel control while it runs", () => {
  assert.deepEqual(getAutoHighlightButtonPresentation({ running: false }), {
    label: "Highlight key passages",
    disabled: false,
    action: "start",
  });
  assert.deepEqual(getAutoHighlightButtonPresentation({ running: true }), {
    label: "Cancel highlighting",
    disabled: false,
    action: "cancel",
  });
  assert.deepEqual(
    getAutoHighlightButtonPresentation({ running: true, cancelling: true }),
    { label: "Cancelling highlighting…", disabled: true, action: "none" },
  );
  assert.equal(AUTO_HIGHLIGHT_CANCELLED_STATUS, "Highlighting cancelled");
});
