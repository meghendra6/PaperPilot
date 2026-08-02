import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishReaderRunsForMode,
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  markReaderRunFinished,
  markReaderRunStarted,
  notifyReaderPaneStateChanged,
  subscribeToReaderRunEvents,
} from "../src/modules/ai/runPresentation";

test("reader run presentation is item-scoped and keeps the newest active run", () => {
  const events: string[] = [];
  const unsubscribe = subscribeToReaderRunEvents(9101, (event) => {
    events.push(
      event.type === "state_changed"
        ? event.type
        : `${event.type}:${event.mode}`,
    );
  });

  const codex = markReaderRunStarted(9101, "codex_cli");
  const claude = markReaderRunStarted(9101, "claude_code");
  markReaderRunStarted(9102, "gemini_cli");

  assert.equal(getActiveReaderRunMode(9101), "claude_code");
  assert.equal(getActiveReaderRunMode(9102), "gemini_cli");
  assert.equal(isReaderRunTokenActive(9101, codex), true);

  markReaderRunFinished(9101, codex);
  assert.equal(isReaderRunTokenActive(9101, codex), false);
  assert.equal(getActiveReaderRunMode(9101), "claude_code");

  markReaderRunFinished(9101, claude);
  notifyReaderPaneStateChanged(9101);
  assert.equal(getActiveReaderRunMode(9101), undefined);
  assert.deepEqual(events, [
    "started:codex_cli",
    "started:claude_code",
    "finished:codex_cli",
    "finished:claude_code",
    "state_changed",
  ]);

  unsubscribe();
  unsubscribe();
  finishReaderRunsForMode(9102, "gemini_cli");
});

test("stopping a mode clears all of its activities without clearing another mode", () => {
  markReaderRunStarted(9201, "codex_cli");
  markReaderRunStarted(9201, "codex_cli");
  const gemini = markReaderRunStarted(9201, "gemini_cli");

  finishReaderRunsForMode(9201, "codex_cli");
  assert.equal(getActiveReaderRunMode(9201), "gemini_cli");

  markReaderRunFinished(9201, gemini);
  assert.equal(getActiveReaderRunMode(9201), undefined);
});
