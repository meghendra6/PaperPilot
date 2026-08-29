import { test } from "node:test";
import * as assert from "node:assert/strict";

import type {
  ResearchProject,
  ResearchWorkspaceProjectMember,
  ResearchWorkspaceSourceRecord,
} from "../src/modules/researchWorkspace/persistence/contracts";
import {
  buildResearchWorkspaceScreeningLog,
  createScreeningDecisionEvent,
  detectScreeningIssues,
  reconcileScreeningCriteria,
  screeningDecisionMatchesInput,
  serializeResearchWorkspaceScreeningLogCsv,
} from "../src/modules/researchWorkspace/screeningLog";

function source(
  sourceID: string,
  title: string,
  options: {
    doi?: string;
    year?: number;
    availability?: ResearchWorkspaceSourceRecord["availability"];
  } = {},
): ResearchWorkspaceSourceRecord {
  return {
    sourceID,
    identity: {
      libraryID: 1,
      itemKey: `${sourceID}-item`,
      attachmentKey: `${sourceID}-pdf`,
      standaloneAttachment: false,
    },
    title,
    ...(options.doi ? { doi: options.doi } : {}),
    ...(options.year ? { year: options.year } : {}),
    contentFingerprint: {
      algorithm: "sha256",
      value: `fingerprint-${sourceID}`,
    },
    extractionQuality:
      options.availability && options.availability !== "ready"
        ? "unavailable"
        : "structured",
    extractionNotes: [],
    availability: options.availability ?? "ready",
    lastResolvedAt: "2026-08-30T00:00:00.000Z",
  };
}

function project(): ResearchProject {
  return {
    projectID: "project-screening",
    name: "Screening",
    scope: {
      inclusionCriteria: [
        {
          criterionID: "criterion-inclusion-1",
          text: "Reports the target population",
          enabled: true,
          createdBy: "user",
          acceptedAt: "2026-08-30T00:00:00.000Z",
        },
      ],
      exclusionCriteria: [
        {
          criterionID: "criterion-exclusion-1",
          text: "Duplicate report",
          enabled: true,
          createdBy: "user",
          acceptedAt: "2026-08-30T00:00:00.000Z",
        },
      ],
    },
    artifactIDs: [],
    runIDs: [],
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

test("screening criteria reconciliation retains stable IDs and clones edits", () => {
  const existing = project().scope!.inclusionCriteria;
  const reconciled = reconcileScreeningCriteria({
    existing,
    lines: [" Reports the target population ", "Uses a relevant outcome"],
    kind: "inclusion",
    acceptedAt: "2026-08-30T01:00:00.000Z",
  });
  assert.equal(reconciled[0].criterionID, "criterion-inclusion-1");
  assert.match(reconciled[1].criterionID, /^criterion-inclusion-/);
  assert.notEqual(reconciled[0], existing[0]);
  assert.equal(existing[0].text, "Reports the target population");
});

test("screening decisions reject criteria without criterion provenance", () => {
  assert.throws(
    () =>
      createScreeningDecisionEvent({
        input: {
          projectID: "project-screening",
          sourceID: "source-1",
          stage: "abstract",
          decision: "maybe",
          reasonCode: "other",
          reason: "Needs review",
          criterionIDs: ["criterion-inclusion-1"],
          submissionID: "submission-invalid",
          expectedProjectRevision: 0,
          expectedMembersRevision: 0,
        },
        source: source("source-1", "Paper One"),
        project: project(),
        eventID: "screening-event-invalid",
        decidedAt: "2026-08-30T01:00:00.000Z",
      }),
    /criterion screening reason code/,
  );
});

test("duplicate and missing-PDF detection is deterministic and never decides", () => {
  const sources = [
    source("source-b", "Same Paper", { doi: "https://doi.org/10.1/ABC" }),
    source("source-a", "Different title", { doi: "10.1/abc." }),
    source("source-c", "Fallback Match", { year: 2024 }),
    source("source-d", " fallback  match ", { year: 2024 }),
    source("source-e", "Unavailable", { availability: "missing-file" }),
  ];
  const forward = detectScreeningIssues(sources);
  const reverse = detectScreeningIssues([...sources].reverse());
  assert.deepEqual(reverse, forward);
  assert.equal(forward.filter((issue) => issue.kind === "duplicate").length, 2);
  assert.equal(
    forward.filter((issue) => issue.kind === "missing-pdf").length,
    1,
  );
  assert.equal("decision" in forward[0], false);
});

test("review log keeps immutable history and exports every event safely", () => {
  const reviewProject = project();
  const paper = source("source-1", "=Formula, Paper", {
    doi: "10.1000/example",
    year: 2025,
  });
  const first = createScreeningDecisionEvent({
    input: {
      projectID: reviewProject.projectID,
      sourceID: paper.sourceID,
      stage: "abstract",
      decision: "maybe",
      reasonCode: "other",
      reason: "Needs full text",
      submissionID: "submission-1",
      expectedProjectRevision: 0,
      expectedMembersRevision: 0,
    },
    source: paper,
    project: reviewProject,
    eventID: "screening-event-1",
    decidedAt: "2026-08-30T01:00:00.000Z",
  });
  assert.equal(
    screeningDecisionMatchesInput(first, {
      projectID: reviewProject.projectID,
      sourceID: paper.sourceID,
      stage: "abstract",
      decision: "maybe",
      reason: "Needs full text",
      submissionID: "submission-1",
      expectedProjectRevision: 0,
      expectedMembersRevision: 0,
    }),
    true,
  );
  const second = createScreeningDecisionEvent({
    input: {
      projectID: reviewProject.projectID,
      sourceID: paper.sourceID,
      stage: "full-text",
      decision: "exclude",
      reasonCode: "criterion",
      reason: "Duplicate report after full-text review",
      criterionIDs: ["criterion-exclusion-1"],
      note: "+reviewer note",
      submissionID: "submission-2",
      expectedProjectRevision: 0,
      expectedMembersRevision: 1,
    },
    source: paper,
    project: reviewProject,
    previous: first,
    eventID: "screening-event-2",
    decidedAt: "2026-08-30T02:00:00.000Z",
  });
  reviewProject.scope!.exclusionCriteria[0].text = "Changed later";
  paper.title = "Changed later";
  assert.equal(second.protocolSnapshot[1].text, "Duplicate report");
  assert.equal(second.sourceSnapshot.title, "=Formula, Paper");

  const member: ResearchWorkspaceProjectMember = {
    sourceID: paper.sourceID,
    role: "candidate",
    reviewStatus: "excluded",
    exclusionReason: second.reason!.text,
    screeningEvents: [first, second],
    addedAt: "2026-08-30T00:00:00.000Z",
    updatedAt: second.decidedAt,
  };
  const log = buildResearchWorkspaceScreeningLog({
    project: reviewProject,
    members: [member],
    sources: [paper],
    generatedAt: "2026-08-30T03:00:00.000Z",
  });
  assert.equal(log.summary.exclude, 1);
  assert.equal(log.summary.decisions, 2);
  assert.equal(log.rows[0].history.length, 2);
  assert.equal(log.rows[0].current?.supersedesEventID, first.eventID);
  const csv = serializeResearchWorkspaceScreeningLogCsv(log);
  assert.match(csv, /screening-event-1/);
  assert.match(csv, /screening-event-2/);
  assert.match(csv, /"'=Formula, Paper"/);
  assert.match(csv, /"'\+reviewer note"/);
});

test("legacy screening state remains visible without fabricated history", () => {
  const paper = source("source-legacy", "Legacy Paper");
  const member: ResearchWorkspaceProjectMember = {
    sourceID: paper.sourceID,
    role: "candidate",
    reviewStatus: "included",
    addedAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
  const log = buildResearchWorkspaceScreeningLog({
    project: project(),
    members: [member],
    sources: [paper],
    generatedAt: "2026-08-30T03:00:00.000Z",
  });
  assert.equal(log.rows[0].legacyDecision, "include");
  assert.deepEqual(log.rows[0].history, []);
  assert.equal(log.summary.include, 1);
});
