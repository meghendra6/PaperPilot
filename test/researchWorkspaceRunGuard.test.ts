import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmCancelRunningAnalysis,
  describeRunGuard,
  type RunGuardPromptService,
} from "../src/modules/researchWorkspace/runGuard";

function promptReturning(choice: number) {
  const calls: unknown[][] = [];
  const prompt: RunGuardPromptService = {
    BUTTON_POS_0: 1,
    BUTTON_POS_1: 256,
    BUTTON_TITLE_IS_STRING: 127,
    BUTTON_POS_1_DEFAULT: 0x01000000,
    confirmEx: (...args) => {
      calls.push(args);
      return choice;
    },
  };
  return { prompt, calls };
}

test("the run guard names both explicit choices", () => {
  const { prompt, calls } = promptReturning(0);
  assert.equal(
    confirmCancelRunningAnalysis(
      { action: "Opening all projects" },
      { prompt },
    ),
    true,
  );
  const [, title, message, flags, cancel, keep] = calls[0];
  assert.equal(title, "Cancel the running analysis?");
  assert.match(String(message), /^Opening all projects cancels/);
  assert.equal(cancel, "Cancel run and continue");
  assert.equal(keep, "Keep running");
  assert.equal(flags, 127 + 256 * 127 + 0x01000000);
});

test("keeping the run or dismissing the dialog never cancels", () => {
  assert.equal(
    confirmCancelRunningAnalysis(
      { action: "Saving the project" },
      { prompt: promptReturning(1).prompt },
    ),
    false,
  );
  assert.equal(
    confirmCancelRunningAnalysis({ action: "x" }, { prompt: {} }),
    false,
    "no dialog API means the run is kept",
  );
});

test("window close uses close-specific wording and the confirm fallback", () => {
  const copy = describeRunGuard({ action: "Closing", closing: true });
  assert.equal(copy.cancelLabel, "Cancel run and close");
  assert.equal(copy.keepLabel, "Keep window open");
  let shown = "";
  const result = confirmCancelRunningAnalysis(
    { action: "Closing", closing: true },
    {
      prompt: {},
      win: {
        confirm: (message) => {
          shown = message;
          return true;
        },
      },
    },
  );
  assert.equal(result, true);
  assert.match(shown, /Closing the Research Workspace cancels/);
  assert.match(shown, /OK: Cancel run and close/);
});
