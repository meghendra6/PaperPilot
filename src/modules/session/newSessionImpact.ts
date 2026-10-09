import type { CriticalReadState } from "../criticalRead/types";
import type { SessionHistoryPersistenceMode } from "./historyTypes";

export interface NewSessionMasteryProgress {
  phase: string;
  rounds: readonly unknown[];
  currentQuestion?: string;
  finalReport?: string;
}

export interface NewSessionImpact {
  title: string;
  message: string;
}

function describeCriticalRead(
  state: Pick<CriticalReadState, "phase" | "steps"> | undefined,
) {
  if (!state || state.phase === "idle") return undefined;
  if (state.phase === "complete") return "Critical Read (complete report)";
  const completed = state.steps.filter(
    (step) => step.status === "complete",
  ).length;
  return completed
    ? `Critical Read (${completed}/7 steps)`
    : "Critical Read (started)";
}

function describeMastery(state: NewSessionMasteryProgress | undefined) {
  if (!state) return undefined;
  if (state.phase === "complete") return "Paper Mastery (final report)";
  if (state.rounds.length)
    return `Paper Mastery (${state.rounds.length} answered question${state.rounds.length === 1 ? "" : "s"})`;
  if (state.phase !== "idle" || state.currentQuestion)
    return "Paper Mastery (in progress)";
  return undefined;
}

/**
 * Explains what starting a new session does to reader-owned Critical Read and
 * Paper Mastery work under the current history setting. Returns undefined
 * when there is nothing to lose, so no confirmation is needed.
 */
export function describeNewSessionImpact(params: {
  criticalRead?: Pick<CriticalReadState, "phase" | "steps">;
  mastery?: NewSessionMasteryProgress;
  historyMode: SessionHistoryPersistenceMode;
}): NewSessionImpact | undefined {
  const work = [
    describeCriticalRead(params.criticalRead),
    describeMastery(params.mastery),
  ].filter((entry): entry is string => Boolean(entry));
  if (!work.length) return undefined;
  const subject = work.join(" and ");
  const outcome =
    params.historyMode === "full"
      ? `Your ${subject} will move to Past sessions, where you can reopen ${work.length > 1 ? "them" : "it"}.`
      : params.historyMode === "prompts-only"
        ? `Your history setting saves prompts only, so your ${subject} will be lost.`
        : `Session history is off, so your ${subject} will be lost.`;
  return {
    title: "Start a new session?",
    message: `${outcome} The new session starts without this work.`,
  };
}
