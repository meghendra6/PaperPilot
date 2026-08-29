import type { ResearchWorkspacePaper } from "./paperSource";

export interface CrossPaperMasterySourceSnapshotEntry {
  sourceID: string;
  contentFingerprint: string;
}

export interface PersistentCrossPaperMasterySession {
  schemaVersion: number;
  revision: number;
  id: string;
  projectID?: string;
  sourceSnapshot: CrossPaperMasterySourceSnapshotEntry[];
  state: string;
  questions: Array<{ id: string; [key: string]: unknown }>;
  attempts: Array<{ id: string; questionId: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

const PERSISTENT_MASTERY_STATES = new Set([
  "generating-question",
  "awaiting-answer",
  "evaluating",
  "ready-for-question",
  "complete",
  "cancelled",
  "stale",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function confidence(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export function buildCrossPaperMasterySourceSnapshot(
  papers: readonly ResearchWorkspacePaper[],
): CrossPaperMasterySourceSnapshotEntry[] {
  const entries = papers.map((paper) => ({
    sourceID: paper.sourceID,
    contentFingerprint: paper.contentFingerprint.value,
  }));
  if (new Set(entries.map((entry) => entry.sourceID)).size !== entries.length) {
    throw new Error("Cross-paper mastery requires distinct sources.");
  }
  return entries.sort((left, right) =>
    left.sourceID.localeCompare(right.sourceID),
  );
}

export function isPersistentCrossPaperMasterySession(
  value: unknown,
): value is PersistentCrossPaperMasterySession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (
    session.schemaVersion !== 2 ||
    typeof session.id !== "string" ||
    !session.id.trim() ||
    !Number.isInteger(session.revision) ||
    Number(session.revision) < 0 ||
    typeof session.state !== "string" ||
    !PERSISTENT_MASTERY_STATES.has(session.state) ||
    !Array.isArray(session.sourceSnapshot) ||
    !Array.isArray(session.questions) ||
    !Array.isArray(session.attempts)
  ) {
    return false;
  }
  const snapshots = session.sourceSnapshot.map(record);
  if (
    snapshots.some(
      (entry) =>
        !entry ||
        typeof entry.sourceID !== "string" ||
        !entry.sourceID.trim() ||
        typeof entry.contentFingerprint !== "string" ||
        !entry.contentFingerprint.trim(),
    ) ||
    new Set(snapshots.map((entry) => entry?.sourceID)).size !== snapshots.length
  ) {
    return false;
  }
  const questions = session.questions.map(record);
  const questionIDs = questions.map((entry) => entry?.id);
  if (
    questions.some(
      (entry) => !entry || typeof entry.id !== "string" || !entry.id.trim(),
    ) ||
    new Set(questionIDs).size !== questionIDs.length
  ) {
    return false;
  }
  const attempts = session.attempts.map(record);
  const attemptIDs = attempts.map((entry) => entry?.id);
  return !(
    attempts.some(
      (entry) =>
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id.trim() ||
        typeof entry.questionId !== "string" ||
        !questionIDs.includes(entry.questionId) ||
        (entry.learnerConfidence !== undefined &&
          (!Number.isFinite(Number(entry.learnerConfidence)) ||
            Number(entry.learnerConfidence) < 0 ||
            Number(entry.learnerConfidence) > 1)) ||
        (entry.graderConfidence !== undefined &&
          (!Number.isFinite(Number(entry.graderConfidence)) ||
            Number(entry.graderConfidence) < 0 ||
            Number(entry.graderConfidence) > 1)),
    ) || new Set(attemptIDs).size !== attemptIDs.length
  );
}

export function crossPaperMasterySnapshotMatches(
  session: PersistentCrossPaperMasterySession,
  projectID: string,
  papers: readonly ResearchWorkspacePaper[],
) {
  if (session.projectID && session.projectID !== projectID) return false;
  const expected = buildCrossPaperMasterySourceSnapshot(papers);
  const actual = [...session.sourceSnapshot].sort((left, right) =>
    left.sourceID.localeCompare(right.sourceID),
  );
  return (
    actual.length === expected.length &&
    expected.every(
      (entry, index) =>
        actual[index]?.sourceID === entry.sourceID &&
        actual[index]?.contentFingerprint === entry.contentFingerprint,
    )
  );
}

export function getCrossPaperMasteryCurrentQuestion(
  session: PersistentCrossPaperMasterySession,
) {
  const question = session.questions[session.questions.length - 1];
  if (!question) return undefined;
  return session.attempts.some((attempt) => attempt.questionId === question.id)
    ? undefined
    : question;
}

export function isCrossPaperMasterySubmissionReplay(params: {
  attempt: Record<string, unknown>;
  questionID: string;
  answer: string;
  learnerConfidence?: number;
}) {
  return (
    params.attempt.questionId === params.questionID &&
    String(params.attempt.answer ?? "").trim() === params.answer.trim() &&
    confidence(params.attempt.learnerConfidence) ===
      confidence(params.learnerConfidence)
  );
}
