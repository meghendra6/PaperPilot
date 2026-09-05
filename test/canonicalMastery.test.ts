import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  createCanonicalMasteryRound,
  scheduleMasteryReview,
  summarizeCanonicalMastery,
} from "../src/modules/comprehensionCheck/analytics";
import {
  addCrossPaperAttempt,
  addCrossPaperQuestion,
  createCrossPaperMasterySession,
  summarizeCrossPaperMastery,
} from "../src/modules/researchWorkspace/core/crossPaperMastery/engine";
import {
  buildCrossPaperMasterySourceSnapshot,
  crossPaperMasterySnapshotMatches,
  getCrossPaperMasteryCurrentQuestion,
  isCrossPaperMasterySubmissionReplay,
  isPersistentCrossPaperMasterySession,
  isAnalyzableCrossPaperSession,
} from "../src/modules/researchWorkspace/masteryPersistence";
import type { ResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";

function paper(
  id: string,
  fingerprint = `fingerprint-${id}`,
): ResearchWorkspacePaper {
  return {
    sourceID: `zotero:1:ITEM-${id}:PDF-${id}`,
    paperKey: `zotero:1:ITEM-${id}:PDF-${id}`,
    libraryID: 1,
    itemKey: `ITEM-${id}`,
    itemID: id.charCodeAt(0),
    attachmentID: id.charCodeAt(0) + 100,
    attachmentKey: `PDF-${id}`,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: fingerprint,
    },
    title: `Paper ${id}`,
    context: `Paper ${id} context`,
    extractionQuality: "zotero_text",
  };
}

test("canonical mastery records rubric scoring, learner calibration, and review schedule", () => {
  const now = new Date("2026-08-30T00:00:00.000Z");
  const round = createCanonicalMasteryRound({
    question: "Explain the mechanism.",
    answer: "The target verifies the draft.",
    topic: "verification",
    difficulty: "intermediate",
    learnerConfidence: 0.9,
    evaluation: {
      understood: true,
      confidence: 0.95,
      criterionScores: [
        { criterionID: "accuracy", score: 2, feedback: "Correct" },
        { criterionID: "completeness", score: 1, feedback: "Partial" },
        { criterionID: "evidence", score: 2, feedback: "Grounded" },
        { criterionID: "reasoning", score: 1, feedback: "Partial" },
      ],
      evaluation: "Mostly correct.",
      misunderstandings: ["Accepted-prefix detail"],
      explanation: "The accepted prefix is committed.",
      nextTopic: "accepted prefix",
      nextDifficulty: "advanced",
    },
    now,
  });
  assert.equal(round.normalizedScore, 0.75);
  assert.equal(round.learnerConfidence, 0.9);
  assert.equal(round.criterionScores?.length, 4);
  const schedule = scheduleMasteryReview({ score: 0.75, now });
  assert.equal(schedule.algorithmVersion, "paperpilot-mastery-scheduler-v1");
  assert.equal(schedule.nextReviewAt, "2026-08-31T00:00:00.000Z");
  const summary = summarizeCanonicalMastery([round], schedule);
  assert.equal(summary.averageScore, 0.75);
  assert.equal(summary.calibration, 0.85);
  assert.deepEqual(summary.openMisconceptions, ["Accepted-prefix detail"]);
});

test("cross-paper sessions bind exact source fingerprints and advance revisions", () => {
  const papers = [paper("B"), paper("A")];
  const snapshot = buildCrossPaperMasterySourceSnapshot(papers);
  let session = createCrossPaperMasterySession({
    id: "session-1",
    projectID: "project-1",
    collectionKey: "project-1",
    sourceSnapshot: snapshot,
    concepts: [
      {
        id: "concept-1",
        label: "Comparison",
        paperKeys: papers.map((entry) => entry.paperKey),
      },
    ],
    now: "2026-08-30T00:00:00.000Z",
  });
  session = addCrossPaperQuestion(
    session,
    {
      id: "question-1",
      conceptId: "concept-1",
      paperKeys: papers.map((entry) => entry.paperKey),
      mode: "compare",
      prompt: "Compare the mechanisms",
      difficulty: "advanced",
      createdAt: "2026-08-30T00:01:00.000Z",
      evidence: {},
      criteria: [],
      rubric: [
        {
          id: "criterion-1",
          maxScore: 2,
          description: "Compare",
          requiredPaperKeys: [],
          expectedClaims: [],
          evidence: [],
          paperKeys: [],
          requiredClaims: [],
        },
      ],
    },
    "2026-08-30T00:01:00.000Z",
  );
  assert.equal(session.revision, 1);
  assert.equal(session.state, "awaiting-answer");
  assert.equal(getCrossPaperMasteryCurrentQuestion(session)?.id, "question-1");
  session = addCrossPaperAttempt(
    session,
    {
      id: "submission-1",
      questionId: "question-1",
      answer: "Compared",
      feedback: "Good",
      createdAt: "2026-08-30T00:02:00.000Z",
      learnerConfidence: 0.8,
      graderConfidence: 0.9,
      misconceptions: [],
      grades: [
        {
          criterionId: "criterion-1",
          score: 2,
          maxScore: 2,
          evidence: [],
          feedback: "Good",
        },
      ],
    },
    "2026-08-30T00:02:00.000Z",
  );
  assert.equal(session.revision, 2);
  assert.equal(session.state, "ready-for-question");
  assert.equal(getCrossPaperMasteryCurrentQuestion(session), undefined);
  assert.equal(summarizeCrossPaperMastery(session).calibration, 0.8);
  assert.equal(isPersistentCrossPaperMasterySession(session), true);
  assert.equal(isAnalyzableCrossPaperSession(session), true);
  assert.equal(
    isAnalyzableCrossPaperSession({ ...session, concepts: null }),
    false,
  );
  assert.equal(
    isAnalyzableCrossPaperSession({
      ...session,
      questions: [{ ...session.questions[0], rubric: [null] }],
    }),
    false,
  );
  assert.equal(
    crossPaperMasterySnapshotMatches(session, "project-1", papers),
    true,
  );
  assert.equal(
    crossPaperMasterySnapshotMatches(session, "project-1", [paper("A")]),
    false,
  );
  assert.equal(
    crossPaperMasterySnapshotMatches(session, "project-1", [
      paper("A", "changed"),
      paper("B"),
    ]),
    false,
  );
  assert.throws(
    () =>
      addCrossPaperAttempt(session, {
        id: "submission-1",
        questionId: "question-1",
        answer: "Compared",
        feedback: "Good",
        createdAt: "2026-08-30T00:02:00.000Z",
        learnerConfidence: 0.8,
        graderConfidence: 0.9,
        misconceptions: [],
        grades: [
          {
            criterionId: "criterion-1",
            score: 2,
            maxScore: 2,
            evidence: [],
            feedback: "Good",
          },
        ],
      }),
    /Duplicate attempt/,
  );
  const replayAttempt = {
    id: "submission-replay",
    questionId: "question-1",
    answer: "Same answer",
    learnerConfidence: 0.7,
  };
  assert.equal(
    isCrossPaperMasterySubmissionReplay({
      attempt: replayAttempt,
      questionID: "question-1",
      answer: "Same answer",
      learnerConfidence: 0.7,
    }),
    true,
  );
  assert.equal(
    isCrossPaperMasterySubmissionReplay({
      attempt: replayAttempt,
      questionID: "question-1",
      answer: "Different answer",
      learnerConfidence: 0.7,
    }),
    false,
  );
  assert.equal(
    isPersistentCrossPaperMasterySession({
      ...session,
      sourceSnapshot: [...session.sourceSnapshot, session.sourceSnapshot[0]],
    }),
    false,
  );
  assert.throws(
    () => buildCrossPaperMasterySourceSnapshot([paper("A"), paper("A")]),
    /distinct sources/,
  );
});

test("active canonical mastery states are included in restart persistence", () => {
  const snapshotSource = readFileSync(
    join(process.cwd(), "src", "modules", "session", "sessionSnapshot.ts"),
    "utf8",
  );
  assert.match(snapshotSource, /"awaiting-answer"/);
  assert.match(snapshotSource, /persistedMasteryState/);
  assert.doesNotMatch(
    snapshotSource,
    /function isCompletedMasteryState[\s\S]*?value\.phase === "complete"/,
  );
});
