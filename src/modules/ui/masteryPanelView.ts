import type { ComprehensionCheckState } from "../comprehensionCheck/types";

export const DEFAULT_MASTERY_CONFIDENCE = 0.7;

/**
 * Memory-only pane choices that the saved Mastery state does not hold. They
 * belong to one Mastery run; another run (a new session or a restart in the
 * same session) starts with none.
 */
export interface MasteryPanelChoices {
  /** Identifies the run: chat session plus the run's creation time. */
  runKey?: string;
  /** The evaluated round whose result stays on screen until Next question. */
  reviewRound?: number;
  /** The progress dot the reader opened; rounds.length is the current round. */
  selectedRound?: number;
}

export type MasteryQuestionView =
  | { kind: "current"; markdown: string }
  | { kind: "answered"; roundIndex: number; markdown: string }
  | { kind: "completion"; markdown: string };

export type MasteryFeedbackView =
  | { kind: "result"; roundIndex: number }
  | { kind: "history"; roundIndex: number }
  | { kind: "current" };

export interface MasteryButtonView {
  visible: boolean;
  disabled: boolean;
  label: string;
  title?: string;
}

export interface MasteryPanelView {
  visible: boolean;
  /** The Workbench button that starts, resumes, or restarts Mastery. */
  start: MasteryButtonView;
  status: string;
  question?: MasteryQuestionView;
  feedback?: MasteryFeedbackView;
  answerVisible: boolean;
  answerReadOnly: boolean;
  dotsInteractive: boolean;
  submit: MasteryButtonView;
  next: MasteryButtonView;
  end: MasteryButtonView;
  /** Generates the final report again after it failed or never ran. */
  retryReport: MasteryButtonView;
}

const HIDDEN_BUTTON: MasteryButtonView = {
  visible: false,
  disabled: true,
  label: "",
};

export function hasMasteryProgress(
  state: ComprehensionCheckState | undefined,
): state is ComprehensionCheckState {
  return Boolean(
    state &&
      (state.phase !== "idle" ||
        state.status ||
        state.rounds.length ||
        state.currentQuestion),
  );
}

export function masteryRunKey(
  state: ComprehensionCheckState | undefined,
): string | undefined {
  return state
    ? `${state.sessionID ?? ""}:${state.createdAt ?? ""}`
    : undefined;
}

export function syncMasteryPanelChoices(
  choices: MasteryPanelChoices,
  state: ComprehensionCheckState | undefined,
): MasteryPanelChoices {
  const runKey = masteryRunKey(state);
  return state && runKey === choices.runKey ? choices : { runKey };
}

// The pane rebuilds on tab switches, so per-paper view memory lives here, not
// in the pane closure. Nothing here is persisted.
const panelChoices = new Map<number, MasteryPanelChoices>();
const preparingItems = new Set<number>();

export function getMasteryPanelChoices(itemID: number): MasteryPanelChoices {
  return panelChoices.get(itemID) ?? {};
}

export function setMasteryPanelChoices(
  itemID: number,
  choices: MasteryPanelChoices,
): void {
  panelChoices.set(itemID, choices);
}

/** Mastery is reading the paper before its first question. */
export function isMasteryPreparing(itemID: number): boolean {
  return preparingItems.has(itemID);
}

export function setMasteryPreparing(itemID: number, preparing: boolean): void {
  if (preparing) preparingItems.add(itemID);
  else preparingItems.delete(itemID);
}

function outcomeLabel(understood: boolean) {
  return understood ? "Understood" : "Needs review";
}

export function buildMasteryCompletionMarkdown(
  state: ComprehensionCheckState,
): string {
  const understood = state.rounds.filter((round) => round.understood).length;
  const total = state.rounds.length;
  // A session stopped by a failure is not "complete".
  const heading =
    state.finalReportError && !state.finalReport && !state.running
      ? "Session ended"
      : "Session complete";
  return `## ${heading}\n\nUnderstood **${understood} of ${total}** ${total === 1 ? "question" : "questions"}.`;
}

function getStartButton(
  state: ComprehensionCheckState | undefined,
  context: MasteryViewContext,
): MasteryButtonView {
  if (context.preparing) {
    return {
      visible: true,
      disabled: true,
      label: "Preparing paper…",
      title: "Reading the paper before the first question",
    };
  }
  const phase = hasMasteryProgress(state) ? state.phase : "idle";
  if (phase === "complete") {
    return {
      visible: true,
      disabled: Boolean(state?.running || context.busyReason),
      label: "Restart Paper Mastery",
      title: state?.running
        ? "Wait for the final report to finish"
        : (context.busyReason ??
          "Start over with new questions after you confirm"),
    };
  }
  if (phase !== "idle") {
    // Resuming only shows the panel, so it never waits for the engine.
    return {
      visible: true,
      disabled: false,
      label: "Resume Paper Mastery",
      title: "Show the current Paper Mastery round",
    };
  }
  return {
    visible: true,
    disabled: Boolean(context.busyReason),
    label: "Paper Mastery",
    title:
      context.busyReason ??
      "Answer questions about this paper and get graded feedback",
  };
}

export interface MasteryViewContext {
  answerText: string;
  /** Why another run holds this paper's engine, if one does. */
  busyReason?: string;
  /** Mastery is reading the paper before its first question. */
  preparing?: boolean;
}

/**
 * Derives every Mastery control from the saved state plus the pane's
 * memory-only choices, so live updates and re-renders show the same thing.
 */
export function getMasteryPanelView(
  state: ComprehensionCheckState | undefined,
  choices: MasteryPanelChoices,
  context: MasteryViewContext,
): MasteryPanelView {
  const { answerText } = context;
  if (!hasMasteryProgress(state)) {
    return {
      visible: false,
      start: getStartButton(state, context),
      status: "",
      answerVisible: false,
      answerReadOnly: false,
      dotsInteractive: false,
      submit: HIDDEN_BUTTON,
      next: HIDDEN_BUTTON,
      end: HIDDEN_BUTTON,
      retryReport: HIDDEN_BUTTON,
    };
  }

  const { phase, rounds } = state;
  const latest = rounds.length - 1;
  const running = phase === "evaluating" || phase === "generating-question";
  // A graded answer keeps its result on screen while the next question is
  // prepared, and afterwards until the reader chooses Next question.
  const reviewing =
    latest >= 0 &&
    (phase === "generating-question" ||
      ((phase === "awaiting-answer" || phase === "complete") &&
        choices.reviewRound === latest));
  const dotsInteractive = !running;
  const selectedRound =
    dotsInteractive &&
    choices.selectedRound !== undefined &&
    choices.selectedRound >= 0 &&
    (choices.selectedRound < rounds.length ||
      (choices.selectedRound === rounds.length &&
        phase !== "complete" &&
        phase !== "idle"))
      ? choices.selectedRound
      : undefined;

  let status = state.status;
  if (reviewing && phase !== "complete") {
    const result = `Round ${latest + 1}: ${outcomeLabel(rounds[latest].understood)}.`;
    status =
      phase === "awaiting-answer"
        ? `${result} Next question ready.`
        : `${result} Preparing the next question…`;
  }

  let question: MasteryQuestionView | undefined;
  if (phase === "complete") {
    question = {
      kind: "completion",
      markdown: buildMasteryCompletionMarkdown(state),
    };
  } else if (reviewing) {
    question = {
      kind: "answered",
      roundIndex: latest,
      markdown: rounds[latest].question,
    };
  } else if (
    state.currentQuestion &&
    (phase === "awaiting-answer" || phase === "evaluating")
  ) {
    question = { kind: "current", markdown: state.currentQuestion };
  }

  let feedback: MasteryFeedbackView | undefined;
  if (selectedRound !== undefined) {
    feedback =
      selectedRound === rounds.length
        ? { kind: "current" }
        : { kind: "history", roundIndex: selectedRound };
  } else if (reviewing) {
    feedback = { kind: "result", roundIndex: latest };
  }

  const answerVisible =
    question?.kind === "current" &&
    (phase === "awaiting-answer" || phase === "evaluating");
  const evaluating = phase === "evaluating";
  const ending = phase !== "complete" && phase !== "idle";
  // Grading and the final report need the engine; Mastery's own run is
  // reported by its phase instead.
  const busyReason = running ? undefined : context.busyReason;

  return {
    visible: true,
    start: getStartButton(state, { ...context, busyReason }),
    status,
    question,
    feedback,
    answerVisible,
    answerReadOnly: evaluating,
    dotsInteractive,
    submit: answerVisible
      ? {
          visible: true,
          disabled: evaluating || !answerText.trim() || Boolean(busyReason),
          label: evaluating ? "Evaluating…" : "Submit Answer",
          title: evaluating
            ? "Your answer is being graded"
            : (busyReason ??
              (answerText.trim()
                ? "Grade this answer (Ctrl+Enter or Cmd+Enter)"
                : "Type an answer to submit it")),
        }
      : HIDDEN_BUTTON,
    next:
      reviewing && phase !== "complete"
        ? {
            visible: true,
            disabled: phase !== "awaiting-answer",
            label:
              phase === "awaiting-answer"
                ? "Next question"
                : "Preparing next question…",
          }
        : HIDDEN_BUTTON,
    end: ending
      ? {
          visible: true,
          disabled: running || Boolean(rounds.length && busyReason),
          label: "End Session",
          title: running
            ? "Wait for the current step to finish"
            : rounds.length
              ? (busyReason ??
                "End now and generate a final report from the answered rounds")
              : "Close Paper Mastery; no answered rounds are saved",
        }
      : HIDDEN_BUTTON,
    retryReport:
      phase === "complete" &&
      !state.running &&
      !state.finalReport &&
      rounds.length > 0
        ? {
            visible: true,
            disabled: Boolean(context.busyReason || context.preparing),
            label: "Generate final report",
            title: context.preparing
              ? "Wait until Paper Mastery has read the paper"
              : (context.busyReason ??
                "Write the final report from the answered rounds"),
          }
        : HIDDEN_BUTTON,
  };
}

interface MasteryAnswerDraft {
  sessionID?: string;
  question: string;
  text: string;
  confidence: number;
}

// One unsent answer per paper. Pane re-renders rebuild the textarea, so the
// draft lives here, in memory only, until the answer is graded.
const answerDrafts = new Map<number, MasteryAnswerDraft>();

export function getMasteryAnswerDraft(
  itemID: number,
  sessionID: string | undefined,
  question: string | undefined,
): { text: string; confidence: number } {
  const draft = answerDrafts.get(itemID);
  return draft &&
    question &&
    draft.sessionID === sessionID &&
    draft.question === question
    ? { text: draft.text, confidence: draft.confidence }
    : { text: "", confidence: DEFAULT_MASTERY_CONFIDENCE };
}

export function setMasteryAnswerDraft(
  itemID: number,
  sessionID: string | undefined,
  question: string,
  update: { text?: string; confidence?: number },
): void {
  const current = getMasteryAnswerDraft(itemID, sessionID, question);
  answerDrafts.set(itemID, {
    sessionID,
    question,
    text: update.text ?? current.text,
    confidence: update.confidence ?? current.confidence,
  });
}

export function clearMasteryAnswerDraft(itemID: number): void {
  answerDrafts.delete(itemID);
}

/** Drops every memory-only Mastery value of a paper. */
export function clearMasteryPanelMemory(itemID: number): void {
  answerDrafts.delete(itemID);
  panelChoices.delete(itemID);
  preparingItems.delete(itemID);
}
