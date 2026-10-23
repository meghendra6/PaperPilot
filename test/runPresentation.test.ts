import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishAllReaderRuns,
  finishReaderRunsForMode,
  getActiveReaderRunMode,
  isReaderRunTokenActive,
  listActiveReaderRuns,
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
  markReaderRunStarted(9102, "codex_cli");

  assert.equal(getActiveReaderRunMode(9101), "claude_code");
  assert.equal(getActiveReaderRunMode(9102), "codex_cli");
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
  finishReaderRunsForMode(9102, "codex_cli");
});

test("stopping a mode clears all of its activities without clearing another mode", () => {
  markReaderRunStarted(9201, "codex_cli");
  markReaderRunStarted(9201, "codex_cli");
  const claude = markReaderRunStarted(9201, "claude_code");

  finishReaderRunsForMode(9201, "codex_cli");
  assert.equal(getActiveReaderRunMode(9201), "claude_code");

  markReaderRunFinished(9201, claude);
  assert.equal(getActiveReaderRunMode(9201), undefined);
});

test("a throwing listener does not stop later listeners or the state change", () => {
  const seen: string[] = [];
  const unsubscribeThrowing = subscribeToReaderRunEvents(9301, () => {
    throw new Error("render failed");
  });
  const unsubscribeLater = subscribeToReaderRunEvents(9301, (event) => {
    seen.push(event.type);
  });
  try {
    const token = markReaderRunStarted(9301, "codex_cli");
    assert.equal(isReaderRunTokenActive(9301, token), true);
    markReaderRunFinished(9301, token);
    assert.equal(isReaderRunTokenActive(9301, token), false);
    assert.deepEqual(seen, ["started", "finished"]);
  } finally {
    unsubscribeThrowing();
    unsubscribeLater();
  }
});

test("finishAllReaderRuns revokes every token on every paper", () => {
  const finished: string[] = [];
  const unsubscribe = subscribeToReaderRunEvents(9401, (event) => {
    if (event.type === "finished") finished.push(event.mode);
  });
  try {
    const codex = markReaderRunStarted(9401, "codex_cli");
    const claude = markReaderRunStarted(9402, "claude_code");
    finishAllReaderRuns();
    assert.equal(isReaderRunTokenActive(9401, codex), false);
    assert.equal(isReaderRunTokenActive(9402, claude), false);
    assert.deepEqual(listActiveReaderRuns(), []);
    assert.deepEqual(finished, ["codex_cli"]);
  } finally {
    unsubscribe();
  }
});
