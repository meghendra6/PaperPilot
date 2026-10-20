import * as assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ComprehensionCheckState,
  MasteryRound,
} from "../src/modules/comprehensionCheck/types";
import {
  clearMasteryAnswerDraft,
  getMasteryAnswerDraft,
  getMasteryPanelView,
  setMasteryAnswerDraft,
  syncMasteryPanelChoices,
  clearMasteryPanelMemory,
  getMasteryPanelChoices,
  isMasteryPreparing,
  masteryRunKey,
  setMasteryPanelChoices,
  setMasteryPreparing,
} from "../src/modules/ui/masteryPanelView";

function round(question: string, understood: boolean): MasteryRound {
  return {
    question,
    userAnswer: `answer to ${question}`,
    evaluation: `feedback on ${question}`,
    understood,
  };
}

function makeState(
  overrides: Partial<ComprehensionCheckState> = {},
): ComprehensionCheckState {
  return {
    sessionID: "s1",
    phase: "awaiting-answer",
    running: false,
    status: "Topic: method (intermediate)",
    rounds: [],
    topics: [],
    currentQuestion: "Q1",
    ...overrides,
  };
}

const idle = { answerText: "" };

test("Mastery stays hidden until it starts and names why it cannot start", () => {
  const hidden = getMasteryPanelView(undefined, {}, idle);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.start.label, "Paper Mastery");
  assert.equal(hidden.start.disabled, false);

  const busy = getMasteryPanelView(
    undefined,
    {},
    { answerText: "", busyReason: "Wait for the current answer to finish." },
  );
  assert.equal(busy.start.disabled, true);
  assert.equal(busy.start.title, "Wait for the current answer to finish.");

  const preparing = getMasteryPanelView(
    undefined,
    {},
    { answerText: "", preparing: true },
  );
  assert.equal(preparing.start.disabled, true);
  assert.equal(preparing.start.label, "Preparing paper…");
});

test("a failed first question keeps its saved status and offers a fresh start", () => {
  const view = getMasteryPanelView(
    makeState({
      phase: "idle",
      currentQuestion: undefined,
      status:
        "The first question was not generated. Click Paper Mastery to try again.",
    }),
    { runKey: "s1:" },
    idle,
  );
  assert.equal(view.visible, true);
  assert.match(view.status, /Click Paper Mastery to try again/);
  assert.equal(view.start.label, "Paper Mastery");
  assert.equal(view.question, undefined);
  assert.equal(view.answerVisible, false);
  assert.equal(view.end.visible, false);
});

test("Submit needs an answer and an idle engine", () => {
  const state = makeState();
  const empty = getMasteryPanelView(state, { runKey: "s1:" }, idle);
  assert.deepEqual(empty.question, { kind: "current", markdown: "Q1" });
  assert.equal(empty.answerVisible, true);
  assert.equal(empty.submit.disabled, true);
  assert.equal(empty.submit.title, "Type an answer to submit it");
  assert.equal(empty.end.disabled, false);
  assert.equal(empty.start.label, "Resume Paper Mastery");

  const typed = getMasteryPanelView(
    state,
    { runKey: "s1:" },
    { answerText: "  my answer " },
  );
  assert.equal(typed.submit.disabled, false);

  const busy = getMasteryPanelView(
    makeState({ rounds: [round("Q0", true)] }),
    { runKey: "s1:" },
    { answerText: "my answer", busyReason: "Wait for highlighting to finish." },
  );
  assert.equal(busy.submit.disabled, true);
  assert.equal(busy.submit.title, "Wait for highlighting to finish.");
  // Ending with answered rounds starts the final report, so it waits too.
  assert.equal(busy.end.disabled, true);
  assert.equal(busy.end.title, "Wait for highlighting to finish.");
  // Resuming only shows the panel and never waits for the engine.
  assert.equal(busy.start.disabled, false);
});

test("grading keeps the answer visible but read-only", () => {
  const view = getMasteryPanelView(
    makeState({
      phase: "evaluating",
      running: true,
      status: "Evaluating your answer...",
    }),
    { runKey: "s1:", selectedRound: 0 },
    { answerText: "my answer" },
  );
  assert.equal(view.answerVisible, true);
  assert.equal(view.answerReadOnly, true);
  assert.equal(view.submit.disabled, true);
  assert.equal(view.submit.label, "Evaluating…");
  assert.equal(view.end.disabled, true);
  assert.equal(view.dotsInteractive, false);
  assert.equal(view.feedback, undefined);
});

test("a graded result stays on screen while the next question is prepared", () => {
  const state = makeState({
    phase: "generating-question",
    running: true,
    status: "Generating next question...",
    rounds: [round("Q1", false)],
    currentQuestion: "Q1",
  });
  // A pane re-render recreates the choices; the result must still show.
  const view = getMasteryPanelView(state, { runKey: "s1:" }, idle);
  assert.deepEqual(view.question, {
    kind: "answered",
    roundIndex: 0,
    markdown: "Q1",
  });
  assert.deepEqual(view.feedback, { kind: "result", roundIndex: 0 });
  assert.equal(
    view.status,
    "Round 1: Needs review. Preparing the next question…",
  );
  assert.equal(view.answerVisible, false);
  assert.equal(view.next.visible, true);
  assert.equal(view.next.disabled, true);
  assert.equal(view.next.label, "Preparing next question…");
  assert.equal(view.end.disabled, true);
});

test("the next question waits for the reader to choose Next question", () => {
  const state = makeState({
    rounds: [round("Q1", true)],
    currentQuestion: "Q2",
  });
  const reviewing = getMasteryPanelView(
    state,
    { runKey: "s1:", reviewRound: 0 },
    idle,
  );
  assert.equal(reviewing.question?.kind, "answered");
  assert.equal(reviewing.status, "Round 1: Understood. Next question ready.");
  assert.equal(reviewing.next.disabled, false);
  assert.equal(reviewing.next.label, "Next question");
  assert.equal(reviewing.submit.visible, false);
  assert.equal(reviewing.end.disabled, false);

  const answering = getMasteryPanelView(state, { runKey: "s1:" }, idle);
  assert.deepEqual(answering.question, { kind: "current", markdown: "Q2" });
  assert.equal(answering.feedback, undefined);
  assert.equal(answering.next.visible, false);
  assert.equal(answering.answerVisible, true);
});

test("an opened progress dot replaces the result until it is closed", () => {
  const state = makeState({
    rounds: [round("Q1", true), round("Q2", false)],
    currentQuestion: "Q3",
  });
  const history = getMasteryPanelView(
    state,
    { runKey: "s1:", reviewRound: 1, selectedRound: 0 },
    idle,
  );
  assert.deepEqual(history.feedback, { kind: "history", roundIndex: 0 });

  const current = getMasteryPanelView(
    state,
    { runKey: "s1:", selectedRound: 2 },
    idle,
  );
  assert.deepEqual(current.feedback, { kind: "current" });

  const outOfRange = getMasteryPanelView(
    state,
    { runKey: "s1:", selectedRound: 7 },
    idle,
  );
  assert.equal(outOfRange.feedback, undefined);
});

test("completion counts understood questions without a second score", () => {
  const state = makeState({
    phase: "complete",
    status: "Complete",
    rounds: [round("Q1", true), round("Q2", false)],
    currentQuestion: "Q2",
    finalReport: "Report",
  });
  const view = getMasteryPanelView(
    state,
    { runKey: "s1:", reviewRound: 1 },
    idle,
  );
  assert.equal(view.question?.kind, "completion");
  assert.match(
    view.question?.markdown ?? "",
    /Understood \*\*1 of 2\*\* questions/,
  );
  assert.doesNotMatch(view.question?.markdown ?? "", /Score|Great work/);
  assert.deepEqual(view.feedback, { kind: "result", roundIndex: 1 });
  assert.equal(view.answerVisible, false);
  assert.equal(view.submit.visible, false);
  assert.equal(view.end.visible, false);
  assert.equal(view.start.label, "Restart Paper Mastery");
  assert.equal(view.start.disabled, false);

  const reporting = getMasteryPanelView(
    { ...state, running: true, finalReport: undefined },
    { runKey: "s1:" },
    idle,
  );
  assert.equal(reporting.start.disabled, true);
  assert.equal(reporting.start.title, "Wait for the final report to finish");
});

test("pane choices belong to one Mastery run", () => {
  const run = makeState({ sessionID: "s1", createdAt: "2026-10-20T00:00:00Z" });
  const choices = {
    runKey: masteryRunKey(run),
    reviewRound: 0,
    selectedRound: 0,
  };
  assert.equal(syncMasteryPanelChoices(choices, run), choices);
  // Another session, or a restart in the same session, starts clean.
  assert.deepEqual(
    syncMasteryPanelChoices(choices, { ...run, sessionID: "s2" }),
    { runKey: masteryRunKey({ ...run, sessionID: "s2" }) },
  );
  const restarted = { ...run, createdAt: "2026-10-20T01:00:00Z" };
  assert.deepEqual(syncMasteryPanelChoices(choices, restarted), {
    runKey: masteryRunKey(restarted),
  });
  assert.deepEqual(syncMasteryPanelChoices(choices, undefined), {
    runKey: undefined,
  });
});

test("view memory survives a pane rebuild and clears per paper", () => {
  const itemID = 9002;
  clearMasteryPanelMemory(itemID);
  setMasteryPanelChoices(itemID, { runKey: "s1:t", reviewRound: 2 });
  setMasteryPreparing(itemID, true);
  setMasteryAnswerDraft(itemID, "s1", "Q", { text: "draft" });
  assert.deepEqual(getMasteryPanelChoices(itemID), {
    runKey: "s1:t",
    reviewRound: 2,
  });
  assert.equal(isMasteryPreparing(itemID), true);
  clearMasteryPanelMemory(itemID);
  assert.deepEqual(getMasteryPanelChoices(itemID), {});
  assert.equal(isMasteryPreparing(itemID), false);
  assert.equal(getMasteryAnswerDraft(itemID, "s1", "Q").text, "");
});

test("a failed start has no current round to open, and preparing blocks the report retry", () => {
  const failedStart = makeState({
    phase: "idle",
    currentQuestion: undefined,
    status: "The first question was not generated.",
  });
  assert.equal(
    getMasteryPanelView(failedStart, { selectedRound: 0 }, idle).feedback,
    undefined,
  );
  const ended = makeState({
    phase: "complete",
    rounds: [round("Q1", true)],
    finalReportError: "Could not generate final report.",
  });
  const preparing = getMasteryPanelView(
    ended,
    {},
    { answerText: "", preparing: true },
  );
  assert.equal(preparing.retryReport.disabled, true);
  assert.match(preparing.retryReport.title ?? "", /read the paper/);
});

test("an unsent answer survives a re-render until it is graded", () => {
  const itemID = 9001;
  clearMasteryAnswerDraft(itemID);
  assert.deepEqual(getMasteryAnswerDraft(itemID, "s1", "Q1"), {
    text: "",
    confidence: 0.7,
  });

  setMasteryAnswerDraft(itemID, "s1", "Q1", { text: "draft" });
  setMasteryAnswerDraft(itemID, "s1", "Q1", { confidence: 0.4 });
  assert.deepEqual(getMasteryAnswerDraft(itemID, "s1", "Q1"), {
    text: "draft",
    confidence: 0.4,
  });
  // Another question or session never shows this draft.
  assert.equal(getMasteryAnswerDraft(itemID, "s1", "Q2").text, "");
  assert.equal(getMasteryAnswerDraft(itemID, "s2", "Q1").text, "");
  assert.equal(getMasteryAnswerDraft(itemID, "s1", undefined).text, "");

  clearMasteryAnswerDraft(itemID);
  assert.equal(getMasteryAnswerDraft(itemID, "s1", "Q1").text, "");
});

test("a failed or missing final report can be generated again", () => {
  const failed = makeState({
    phase: "complete",
    status: "Complete",
    rounds: [round("Q1", true)],
    finalReportError: "Could not generate final report.",
  });
  const view = getMasteryPanelView(failed, { runKey: "s1:" }, idle);
  assert.equal(view.retryReport.visible, true);
  assert.equal(view.retryReport.disabled, false);
  assert.match(view.question?.markdown ?? "", /^## Session ended/);

  const busy = getMasteryPanelView(
    failed,
    { runKey: "s1:" },
    { answerText: "", busyReason: "Wait for the current answer to finish." },
  );
  assert.equal(busy.retryReport.disabled, true);
  assert.equal(
    busy.retryReport.title,
    "Wait for the current answer to finish.",
  );

  for (const state of [
    { ...failed, finalReport: "Report", finalReportError: undefined },
    { ...failed, running: true, finalReportError: undefined },
    { ...failed, rounds: [] },
  ]) {
    assert.equal(
      getMasteryPanelView(state, { runKey: "s1:" }, idle).retryReport.visible,
      false,
    );
  }
});
