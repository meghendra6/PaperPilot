import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  RESEARCH_WORKSPACE_LIVING_REVIEW_HISTORY_LIMIT,
  createResearchWorkspaceChangeInbox,
  reconcileResearchWorkspaceLivingReview,
  resolveResearchWorkspaceLivingReviewChange,
  type ResearchWorkspaceLivingReviewObservation,
} from "../src/modules/researchWorkspace/livingReview";

const T0 = "2026-08-30T00:00:00.000Z";

function at(second: number) {
  return `2026-08-30T00:00:${String(second).padStart(2, "0")}.000Z`;
}

function observation(
  sourceID: string,
  contentFingerprint: string | undefined,
  annotationFingerprint: string | undefined,
  availability: ResearchWorkspaceLivingReviewObservation["availability"] = "ready",
): ResearchWorkspaceLivingReviewObservation {
  return {
    sourceID,
    availability,
    ...(contentFingerprint ? { contentFingerprint } : {}),
    ...(annotationFingerprint
      ? {
          annotationFingerprint,
          annotation: {
            algorithm: "zotero-annotation-keys-version-date-v1",
            value: annotationFingerprint,
            count: 1,
          },
        }
      : {}),
  };
}

test("empty inbox and first observations establish a sorted baseline without alerts", () => {
  const empty = createResearchWorkspaceChangeInbox("project-living");
  assert.deepEqual(empty, {
    schemaVersion: 1,
    revision: 0,
    projectID: "project-living",
    snapshots: [],
    changes: [],
  });
  const baseline = reconcileResearchWorkspaceLivingReview(
    empty,
    [
      observation("source-b", "pdf-b", "ann-b"),
      observation("source-a", "pdf-a", "ann-a"),
    ],
    T0,
  );
  assert.equal(empty.initializedAt, undefined);
  assert.equal(baseline.revision, 1);
  assert.equal(baseline.initializedAt, T0);
  assert.equal(baseline.lastCheckedAt, T0);
  assert.deepEqual(
    baseline.snapshots.map((entry) => entry.sourceID),
    ["source-a", "source-b"],
  );
  assert.deepEqual(baseline.changes, []);
  assert.throws(
    () => createResearchWorkspaceChangeInbox("../invalid"),
    /unsupported path characters/,
  );
});

test("a source added after initialization creates an explicit inbox event", () => {
  const baseline = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-new-source"),
    [observation("source-a", "pdf-a", "ann-a")],
    at(0),
  );
  const added = reconcileResearchWorkspaceLivingReview(
    baseline,
    [
      observation("source-a", "pdf-a", "ann-a"),
      observation("source-new", "pdf-new", "ann-new"),
    ],
    at(1),
  );
  assert.equal(added.changes.length, 1);
  assert.equal(added.changes[0].kind, "project-source-added");
  assert.deepEqual(added.changes[0].before, added.changes[0].after);
  assert.deepEqual(
    added.snapshots.map((entry) => entry.sourceID),
    ["source-a", "source-new"],
  );
});

test("PDF and annotation transitions advance from A to B to C", () => {
  const baseline = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-advance"),
    [observation("source-a", "pdf-a", "ann-a")],
    at(0),
  );
  const b = reconcileResearchWorkspaceLivingReview(
    baseline,
    [observation("source-a", "pdf-b", "ann-b")],
    at(1),
  );
  assert.deepEqual(
    b.changes.map((entry) => entry.kind),
    ["pdf-content-changed", "annotations-changed"],
  );
  assert(
    b.changes.every(
      (entry) =>
        entry.before.contentFingerprint === "pdf-a" &&
        entry.after.contentFingerprint === "pdf-b",
    ),
  );
  const c = reconcileResearchWorkspaceLivingReview(
    b,
    [observation("source-a", "pdf-c", "ann-c")],
    at(2),
  );
  assert.equal(c.changes.length, 4);
  assert(
    c.changes
      .slice(2)
      .every(
        (entry) =>
          entry.before.contentFingerprint === "pdf-b" &&
          entry.after.contentFingerprint === "pdf-c",
      ),
  );
  assert.equal(c.snapshots[0].contentFingerprint, "pdf-c");
  assert.equal(c.snapshots[0].annotationFingerprint, "ann-c");
});

test("unavailable and restored states retain last-known fingerprints and expose a restored replacement", () => {
  const baseline = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-availability"),
    [observation("source-a", "pdf-a", "ann-a")],
    at(0),
  );
  const unavailable = reconcileResearchWorkspaceLivingReview(
    baseline,
    [observation("source-a", undefined, undefined, "missing-file")],
    at(1),
  );
  assert.deepEqual(
    unavailable.changes.map((entry) => entry.kind),
    ["source-unavailable"],
  );
  assert.equal(unavailable.snapshots[0].contentFingerprint, "pdf-a");
  assert.equal(unavailable.snapshots[0].annotationFingerprint, "ann-a");

  const restored = reconcileResearchWorkspaceLivingReview(
    unavailable,
    [observation("source-a", "pdf-b", "ann-b")],
    at(2),
  );
  assert.deepEqual(
    restored.changes.slice(1).map((entry) => entry.kind),
    ["source-restored", "pdf-content-changed", "annotations-changed"],
  );
  assert(
    restored.changes
      .slice(1)
      .every((entry) => entry.before.availability === "missing-file"),
  );
});

test("semantic IDs exclude time and repeated transitions are suppressed", () => {
  const baselineA = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-dedupe"),
    [observation("source-a", "pdf-a", "ann-a")],
    at(0),
  );
  const first = reconcileResearchWorkspaceLivingReview(
    baselineA,
    [observation("source-a", "pdf-b", "ann-a")],
    at(1),
  );
  const baselineLater = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-dedupe"),
    [observation("source-a", "pdf-a", "ann-a")],
    at(2),
  );
  const sameTransitionLater = reconcileResearchWorkspaceLivingReview(
    baselineLater,
    [observation("source-a", "pdf-b", "ann-a")],
    at(3),
  );
  assert.equal(
    first.changes[0].changeID,
    sameTransitionLater.changes[0].changeID,
  );
  assert.equal(
    first.changes[0].dedupeKey,
    sameTransitionLater.changes[0].dedupeKey,
  );
  assert.notEqual(
    first.changes[0].detectedAt,
    sameTransitionLater.changes[0].detectedAt,
  );

  const unchanged = reconcileResearchWorkspaceLivingReview(
    first,
    [observation("source-a", "pdf-b", "ann-a")],
    at(2),
  );
  assert.equal(unchanged.changes.length, 1);
  const reversed = reconcileResearchWorkspaceLivingReview(
    unchanged,
    [observation("source-a", "pdf-a", "ann-a")],
    at(3),
  );
  const repeated = reconcileResearchWorkspaceLivingReview(
    reversed,
    [observation("source-a", "pdf-b", "ann-a")],
    at(4),
  );
  assert.equal(repeated.changes.length, 2);
  assert.equal(repeated.snapshots[0].contentFingerprint, "pdf-b");
});

test("reconciliation validates observations, chronology, and annotation identity", () => {
  const baseline = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-validation"),
    [observation("source-a", "pdf-a", "ann-a")],
    at(2),
  );
  assert.throws(
    () =>
      reconcileResearchWorkspaceLivingReview(
        baseline,
        [
          observation("source-a", "pdf-a", "ann-a"),
          observation("source-a", "pdf-a", "ann-a"),
        ],
        at(3),
      ),
    /duplicate source/,
  );
  assert.throws(
    () =>
      reconcileResearchWorkspaceLivingReview(
        baseline,
        [observation("source-a", "pdf-a", "ann-a")],
        at(1),
      ),
    /cannot move backwards/,
  );
  assert.throws(
    () =>
      reconcileResearchWorkspaceLivingReview(
        baseline,
        [
          {
            ...observation("source-a", "pdf-a", "ann-a"),
            annotationFingerprint: "different",
          },
        ],
        at(3),
      ),
    /inconsistent annotation fingerprints/,
  );
});

test("change history is bounded to the newest semantic transitions", () => {
  let inbox = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-bounded"),
    [observation("source-a", "pdf-0", undefined)],
    "2026-08-30T01:00:00.000Z",
  );
  for (
    let index = 1;
    index <= RESEARCH_WORKSPACE_LIVING_REVIEW_HISTORY_LIMIT + 2;
    index += 1
  ) {
    inbox = reconcileResearchWorkspaceLivingReview(
      inbox,
      [observation("source-a", `pdf-${index}`, undefined)],
      new Date(
        Date.parse("2026-08-30T01:00:00.000Z") + index * 1_000,
      ).toISOString(),
    );
  }
  assert.equal(
    inbox.changes.length,
    RESEARCH_WORKSPACE_LIVING_REVIEW_HISTORY_LIMIT,
  );
  assert.equal(inbox.changes[0].before.contentFingerprint, "pdf-2");
  assert.equal(
    inbox.changes.at(-1)?.after.contentFingerprint,
    `pdf-${RESEARCH_WORKSPACE_LIVING_REVIEW_HISTORY_LIMIT + 2}`,
  );
});

test("review and dismiss resolutions are terminal and submission-idempotent", () => {
  const baseline = reconcileResearchWorkspaceLivingReview(
    createResearchWorkspaceChangeInbox("project-resolution"),
    [
      observation("source-a", "pdf-a", "ann-a"),
      observation("source-b", "pdf-a", "ann-a"),
    ],
    at(0),
  );
  const changed = reconcileResearchWorkspaceLivingReview(
    baseline,
    [
      observation("source-a", "pdf-b", "ann-a"),
      observation("source-b", "pdf-b", "ann-a"),
    ],
    at(1),
  );
  const firstChange = changed.changes[0];
  const secondChange = changed.changes[1];
  const reviewed = resolveResearchWorkspaceLivingReviewChange(changed, {
    changeID: firstChange.changeID,
    action: "reviewed",
    submissionID: "submission-1",
    actedAt: at(2),
  });
  assert.equal(changed.changes[0].resolution, undefined);
  assert.equal(reviewed.revision, changed.revision + 1);
  assert.deepEqual(reviewed.changes[0].resolution, {
    action: "reviewed",
    submissionID: "submission-1",
    actedAt: at(2),
  });
  const replay = resolveResearchWorkspaceLivingReviewChange(reviewed, {
    changeID: firstChange.changeID,
    action: "reviewed",
    submissionID: "submission-1",
    actedAt: at(3),
  });
  assert.equal(replay, reviewed);
  assert.throws(
    () =>
      resolveResearchWorkspaceLivingReviewChange(reviewed, {
        changeID: secondChange.changeID,
        action: "reviewed",
        submissionID: "submission-1",
        actedAt: at(3),
      }),
    /idempotency conflict/,
  );
  assert.throws(
    () =>
      resolveResearchWorkspaceLivingReviewChange(reviewed, {
        changeID: firstChange.changeID,
        action: "dismissed",
        submissionID: "submission-2",
        actedAt: at(3),
      }),
    /already resolved/,
  );
  assert.throws(
    () =>
      resolveResearchWorkspaceLivingReviewChange(reviewed, {
        changeID: "missing-change",
        action: "dismissed",
        submissionID: "submission-3",
        actedAt: at(3),
      }),
    /was not found/,
  );
  assert.throws(
    () =>
      resolveResearchWorkspaceLivingReviewChange(changed, {
        changeID: firstChange.changeID,
        action: "dismissed",
        submissionID: "submission-too-early",
        actedAt: at(0),
      }),
    /cannot precede/,
  );
});
