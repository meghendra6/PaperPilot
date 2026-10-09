import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  getBusySubmitHint,
  getChatComposerPresentation,
  SEND_STOP_GUARD_MS,
  shouldIgnoreStopActivation,
} from "../src/modules/ui/chatComposer";

test("Send becomes Stop throughout preparation and response generation", () => {
  const running = getChatComposerPresentation({
    busy: true,
    stopping: false,
    canStop: true,
  });
  assert.equal(running.label, "Stop");
  assert.equal(running.sendAction, "stop");
  assert.equal(running.inputDisabled, false);
  assert.equal(running.buttonDisabled, false);
  assert.match(running.placeholder, /Press Stop/);
});

test("cancellation and cleanup allow drafting but prevent a second send", () => {
  const stopping = getChatComposerPresentation({
    busy: true,
    stopping: true,
    canStop: false,
  });
  assert.equal(stopping.label, "Stopping…");
  assert.equal(stopping.sendAction, "stopping");
  assert.equal(stopping.inputDisabled, false);
  assert.equal(stopping.buttonDisabled, true);
  const cleanup = getChatComposerPresentation({
    busy: true,
    stopping: false,
    canStop: false,
  });
  assert.equal(cleanup.inputDisabled, false);
  assert.equal(cleanup.buttonDisabled, true);
  const settled = getChatComposerPresentation({
    busy: false,
    stopping: false,
    canStop: false,
  });
  assert.equal(settled.label, "Send");
  assert.equal(settled.sendAction, "send");
  assert.equal(settled.inputDisabled, false);
  assert.equal(settled.buttonDisabled, false);
});

test("a double-click on Send does not cancel the request it just sent", () => {
  assert.equal(
    shouldIgnoreStopActivation({ now: 1_000, lastSendAt: 900, clickDetail: 1 }),
    true,
  );
  assert.equal(
    shouldIgnoreStopActivation({ now: 1_000, clickDetail: 2 }),
    true,
  );
  assert.equal(
    shouldIgnoreStopActivation({
      now: 1_000 + SEND_STOP_GUARD_MS,
      lastSendAt: 1_000,
      clickDetail: 1,
    }),
    false,
  );
  assert.equal(
    shouldIgnoreStopActivation({ now: 5_000, clickDetail: 0 }),
    false,
  );
  assert.equal(SEND_STOP_GUARD_MS, 500);
});

test("Enter during a run explains why nothing was sent", () => {
  assert.match(
    getBusySubmitHint({ stopping: false, canStop: true }),
    /still running.*draft is kept.*Stop/,
  );
  assert.match(
    getBusySubmitHint({ stopping: true, canStop: false }),
    /stopping/,
  );
  assert.match(
    getBusySubmitHint({ stopping: false, canStop: false }),
    /another task/,
  );
});
