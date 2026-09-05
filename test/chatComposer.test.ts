import * as assert from "node:assert/strict";
import { test } from "node:test";
import { getChatComposerPresentation } from "../src/modules/ui/chatComposer";

test("Send becomes Stop throughout preparation and response generation", () => {
  const running = getChatComposerPresentation({
    busy: true,
    stopping: false,
    canStop: true,
  });
  assert.equal(running.label, "Stop");
  assert.equal(running.inputDisabled, true);
  assert.equal(running.buttonDisabled, false);
  assert.match(running.placeholder, /press Stop/);
});

test("cancellation and terminal cleanup keep the composer locked until settled", () => {
  const stopping = getChatComposerPresentation({
    busy: true,
    stopping: true,
    canStop: false,
  });
  assert.equal(stopping.label, "Stopping…");
  assert.equal(stopping.inputDisabled, true);
  assert.equal(stopping.buttonDisabled, true);
  const cleanup = getChatComposerPresentation({
    busy: true,
    stopping: false,
    canStop: false,
  });
  assert.equal(cleanup.inputDisabled, true);
  assert.equal(cleanup.buttonDisabled, true);
  const settled = getChatComposerPresentation({
    busy: false,
    stopping: false,
    canStop: false,
  });
  assert.equal(settled.label, "Send");
  assert.equal(settled.inputDisabled, false);
  assert.equal(settled.buttonDisabled, false);
});
