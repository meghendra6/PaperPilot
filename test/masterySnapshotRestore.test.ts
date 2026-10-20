import * as assert from "node:assert/strict";
import { test } from "node:test";
import { persistedMasteryState } from "../src/modules/session/sessionSnapshot";

function interruptedState(overrides: Record<string, unknown>) {
  return {
    schemaVersion: 2,
    revision: 3,
    sessionID: "s1",
    phase: "generating-question",
    running: true,
    status: "Generating next question...",
    rounds: [],
    topics: [],
    ...overrides,
  };
}

test("a session saved while the next question was generated does not reopen the graded question", () => {
  // After grading, currentQuestion still holds the graded question.
  const restored = persistedMasteryState(
    interruptedState({
      currentQuestion: "Q1",
      rounds: [
        {
          question: "Q1",
          userAnswer: "A1",
          evaluation: "Good",
          understood: true,
        },
      ],
    }),
  );
  assert.equal(restored?.phase, "complete");
  assert.equal(restored?.running, false);
  assert.match(restored?.status ?? "", /question generation was interrupted/);
});

test("an interrupted evaluation reopens its question for another submit", () => {
  const restored = persistedMasteryState(
    interruptedState({ phase: "evaluating", currentQuestion: "Q2" }),
  );
  assert.equal(restored?.phase, "awaiting-answer");
  assert.equal(restored?.currentQuestion, "Q2");
});

test("a question that was generated but not yet answered stays open", () => {
  const restored = persistedMasteryState(
    interruptedState({
      currentQuestion: "Q2",
      rounds: [
        {
          question: "Q1",
          userAnswer: "A1",
          evaluation: "Good",
          understood: true,
        },
      ],
    }),
  );
  assert.equal(restored?.phase, "awaiting-answer");
});
