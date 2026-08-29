import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  applyContradictionGapReview,
  buildContradictionGapDashboard,
} from "../src/modules/researchWorkspace/contradictionGap";
import { EVIDENCE_VERIFIER_VERSION } from "../src/modules/researchWorkspace/evidenceVerification";
import { createResearchWorkspaceArtifactView } from "../src/modules/researchWorkspace/artifactRenderer";
import type {
  ResearchWorkspaceArtifact,
  ResearchWorkspaceSourceRecord,
} from "../src/modules/researchWorkspace/persistence/contracts";
import type { ResearchWorkspaceProjectDetails } from "../src/modules/researchWorkspace/projectController";

const NOW = "2026-08-30T12:00:00.000Z";

function source(suffix: string): ResearchWorkspaceSourceRecord {
  return {
    sourceID: `zotero:1:ITEM-${suffix}:PDF-${suffix}`,
    identity: {
      libraryID: 1,
      itemKey: `ITEM-${suffix}`,
      attachmentKey: `PDF-${suffix}`,
      standaloneAttachment: false,
    },
    title: `Paper ${suffix}`,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: `fingerprint-${suffix}`,
    },
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: NOW,
    lastExtractedAt: NOW,
  };
}

function evidence(entry: ResearchWorkspaceSourceRecord, verified = true) {
  return {
    sourceID: entry.sourceID,
    libraryID: entry.identity.libraryID,
    itemKey: entry.identity.itemKey,
    attachmentKey: entry.identity.attachmentKey,
    pageIndex: 1,
    exactQuote: `Evidence from ${entry.title}`,
    schemaVersion: 2,
    verification: {
      status: verified ? "verified" : "not-found",
      method: "pdf-exact-quote",
      ...(verified ? { verifiedAt: NOW } : {}),
      verifierVersion: EVIDENCE_VERIFIER_VERSION,
    },
  };
}

function artifact(params: {
  artifactID: string;
  type: ResearchWorkspaceArtifact["type"];
  sources: ResearchWorkspaceSourceRecord[];
  payload: unknown;
  status?: ResearchWorkspaceArtifact["status"];
  fingerprints?: string[];
}): ResearchWorkspaceArtifact {
  return {
    artifactID: params.artifactID,
    projectID: "project-gap",
    type: params.type,
    title: params.artifactID,
    version: 1,
    status: params.status ?? "complete",
    sourceIDs: params.sources.map((entry) => entry.sourceID),
    lineage: {
      inputs: params.sources.map((entry, index) => ({
        sourceID: entry.sourceID,
        contentFingerprint:
          params.fingerprints?.[index] ?? entry.contentFingerprint!.value,
        contextProjectionFingerprint: `projection-${entry.identity.itemKey}`,
      })),
      operation: params.type,
      operationVersion: `${params.type}-v1`,
      promptVersion: `${params.type}-prompt-v1`,
      parserVersion: `${params.type}-parser-v1`,
      evidenceVerifierVersion: "paperpilot-evidence-v2",
      providerMode: "codex_cli",
      runID: `run-${params.artifactID}`,
    },
    payload: params.payload,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  };
}

function fixture(): ResearchWorkspaceProjectDetails {
  const one = source("A");
  const two = source("B");
  const three = source("C");
  const matrixCells: unknown[] = [];
  const addCell = (
    paper: ResearchWorkspaceSourceRecord,
    columnId: string,
    value: string,
  ) => {
    matrixCells.push({
      paperKey: paper.sourceID,
      columnId,
      value,
      displayValue: value,
      status: "extracted",
      evidence: [evidence(paper)],
    });
  };
  for (const paper of [one, two, three]) {
    addCell(paper, "method", "randomized");
    addCell(paper, "dataset", "D1");
  }
  addCell(one, "population", "adults");
  addCell(two, "population", "adults");
  addCell(three, "population", "children");
  addCell(one, "mortality-rate", "increased");
  addCell(two, "mortality-rate", "decreased");
  addCell(three, "mortality-rate", "decreased");

  const artifacts = [
    artifact({
      artifactID: "artifact-matrix",
      type: "evidence-matrix",
      sources: [one, two, three],
      payload: {
        matrix: {
          columns: [
            { id: "method", label: "Method" },
            { id: "dataset", label: "Dataset" },
            { id: "population", label: "Population" },
            { id: "mortality-rate", label: "Mortality rate" },
          ],
          cells: matrixCells,
        },
      },
    }),
    artifact({
      artifactID: "artifact-synthesis",
      type: "synthesis",
      sources: [one, three],
      payload: {
        claims: [
          {
            statement: "Shared finding",
            evidence: [evidence(one), evidence(three)],
          },
        ],
        agreements: [],
        contradictions: [
          {
            statement: "Upstream contrast without comparable design",
            paperSupported: true,
            evidence: [evidence(one), evidence(three)],
          },
        ],
      },
    }),
    artifact({
      artifactID: "artifact-ledger",
      type: "claim-ledger",
      sources: [one],
      payload: {
        claims: [
          {
            text: "Unverified summary must not become a fact",
            verificationStatus: "verified",
            support: [evidence(one, false)],
          },
          {
            text: "Foreign scoped evidence must not become a fact",
            verificationStatus: "verified",
            support: [evidence(three)],
          },
          {
            text: "Single-source verified claim",
            support: [evidence(one)],
          },
        ],
      },
    }),
    artifact({
      artifactID: "artifact-stale",
      type: "synthesis",
      sources: [one, two],
      status: "stale",
      payload: {
        claims: [],
        agreements: [],
        contradictions: [
          {
            statement: "Dramatic stale contrast",
            evidence: [evidence(one), evidence(two)],
          },
        ],
      },
    }),
    artifact({
      artifactID: "artifact-old-fingerprint",
      type: "claim-ledger",
      sources: [two],
      fingerprints: ["old-fingerprint"],
      payload: {
        claims: [
          {
            text: "Fingerprint mismatch",
            support: [evidence(two)],
          },
        ],
      },
    }),
  ];
  return {
    project: {
      projectID: "project-gap",
      name: "Gap project",
      artifactIDs: artifacts.map((entry) => entry.artifactID),
      runIDs: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
    projectRevision: 2,
    members: [one, two, three].map((entry) => ({
      sourceID: entry.sourceID,
      role: "candidate" as const,
      reviewStatus: "unreviewed" as const,
      addedAt: NOW,
      updatedAt: NOW,
    })),
    membersRevision: 3,
    sources: [one, two, three],
    artifacts,
    warnings: [],
  };
}

test("dashboard admits only current, exact, individually verified evidence", () => {
  const dashboard = buildContradictionGapDashboard({
    details: fixture(),
    generatedAt: NOW,
  });
  assert.equal(dashboard.coverage.includedSources, 3);
  assert.equal(dashboard.coverage.admittedArtifacts, 3);
  assert.equal(dashboard.coverage.excludedArtifacts, 2);
  assert.equal(dashboard.coverage.directContradictions, 1);
  assert.equal(dashboard.coverage.nonComparable, 1);
  assert.equal(dashboard.coverage.uncertain, 1);
  assert.equal(dashboard.coverage.multiSourceSupport, 3);
  assert(
    dashboard.relationships.some(
      (entry) => entry.classification === "direct-contradiction",
    ),
  );
  assert(
    dashboard.relationships.some(
      (entry) => entry.classification === "non-comparable",
    ),
  );
  assert(
    dashboard.relationships.some(
      (entry) => entry.classification === "uncertain",
    ),
  );
  const statements = dashboard.atoms.map((entry) => entry.statement).join("\n");
  assert.doesNotMatch(statements, /Unverified summary/);
  assert.doesNotMatch(statements, /Foreign scoped evidence/);
  assert.doesNotMatch(statements, /Dramatic stale contrast/);
  assert.doesNotMatch(statements, /Fingerprint mismatch/);
  assert(
    dashboard.gaps.some(
      (entry) =>
        entry.kind === "missing-verified-evidence" &&
        entry.statement.includes("Unverified summary"),
    ),
  );
  assert(
    dashboard.gaps.some(
      (entry) =>
        entry.kind === "single-source" &&
        entry.statement.includes("Single-source verified claim"),
    ),
  );
  assert(
    dashboard.gaps.every(
      (entry) => entry.scopeLabel === "current-project-snapshot",
    ),
  );
});

test("dashboard IDs and ordering are stable when project arrays are reversed", () => {
  const details = fixture();
  const reversed = {
    ...details,
    members: [...details.members].reverse(),
    sources: [...details.sources].reverse(),
    artifacts: [...details.artifacts].reverse(),
  };
  const left = buildContradictionGapDashboard({ details, generatedAt: NOW });
  const right = buildContradictionGapDashboard({
    details: reversed,
    generatedAt: NOW,
  });
  assert.deepEqual(right, left);
});

test("generic result columns cannot turn unrelated direction words into a direct contradiction", () => {
  const details = fixture();
  const matrix = details.artifacts.find(
    (entry) => entry.artifactID === "artifact-matrix",
  )!;
  const payload = matrix.payload as {
    matrix: {
      columns: Array<{ id: string; label: string }>;
      cells: Array<{
        columnId: string;
        paperKey: string;
        value: string;
        displayValue: string;
      }>;
    };
  };
  const column = payload.matrix.columns.find(
    (entry) => entry.id === "mortality-rate",
  )!;
  column.id = "primary-result";
  column.label = "Primary result";
  const resultCells = payload.matrix.cells.filter(
    (entry) => entry.columnId === "mortality-rate",
  );
  for (const [index, cell] of resultCells.entries()) {
    cell.columnId = "primary-result";
    cell.value = index === 0 ? "lower latency" : "higher throughput";
    cell.displayValue = cell.value;
  }
  const dashboard = buildContradictionGapDashboard({
    details,
    generatedAt: NOW,
  });
  const generic = dashboard.relationships.filter((entry) =>
    entry.topic.startsWith("primary-result:"),
  );
  assert(generic.length > 0);
  assert(generic.every((entry) => entry.classification === "uncertain"));
  assert(
    generic.every((entry) =>
      entry.limitations.some((limitation) =>
        limitation.includes("concrete shared outcome or metric"),
      ),
    ),
  );
});

test("forged verified-only evidence is not admitted", () => {
  const details = fixture();
  const ledger = details.artifacts.find(
    (entry) => entry.artifactID === "artifact-ledger",
  )!;
  const sourceEntry = details.sources[0];
  const payload = ledger.payload as {
    claims: Array<{ text: string; support: unknown[] }>;
  };
  payload.claims.push({
    text: "Forged verifier status",
    support: [
      {
        sourceID: sourceEntry.sourceID,
        libraryID: sourceEntry.identity.libraryID,
        itemKey: sourceEntry.identity.itemKey,
        attachmentKey: sourceEntry.identity.attachmentKey,
        pageIndex: 1,
        exactQuote: "This object did not come from the verifier.",
        verification: { status: "verified" },
      },
    ],
  });
  const dashboard = buildContradictionGapDashboard({
    details,
    generatedAt: NOW,
  });
  assert.doesNotMatch(
    dashboard.atoms.map((entry) => entry.statement).join("\n"),
    /Forged verifier status/,
  );
});

test("dashboard reviews are append-only, revision guarded, and idempotent", () => {
  const dashboard = buildContradictionGapDashboard({
    details: fixture(),
    generatedAt: NOW,
  });
  const relationship = dashboard.relationships[0];
  const first = applyContradictionGapReview({
    dashboard,
    input: {
      relationshipID: relationship.relationshipID,
      action: "reclassify",
      toClassification: "uncertain",
      reason: "Design detail needs manual review.",
      submissionID: "submission-1",
      expectedDashboardRevision: 0,
    },
    eventID: "event-1",
    reviewedAt: NOW,
  });
  assert.equal(first.revision, 1);
  assert.equal(first.reviewEvents.length, 1);
  assert.equal(
    first.reviewEvents[0].fromClassification,
    relationship.classification,
  );
  const replay = applyContradictionGapReview({
    dashboard: first,
    input: {
      relationshipID: relationship.relationshipID,
      action: "reclassify",
      toClassification: "uncertain",
      reason: "Design detail needs manual review.",
      submissionID: "submission-1",
      expectedDashboardRevision: 0,
    },
    eventID: "ignored",
    reviewedAt: NOW,
  });
  assert.equal(replay, first);
  const second = applyContradictionGapReview({
    dashboard: first,
    input: {
      relationshipID: relationship.relationshipID,
      action: "confirm",
      submissionID: "submission-2",
      expectedDashboardRevision: 1,
    },
    eventID: "event-2",
    reviewedAt: NOW,
  });
  assert.equal(second.reviewEvents[1].fromClassification, "uncertain");
  assert.throws(
    () =>
      applyContradictionGapReview({
        dashboard: second,
        input: {
          relationshipID: relationship.relationshipID,
          action: "dismiss",
          reason: "Changed input",
          submissionID: "submission-1",
          expectedDashboardRevision: 2,
        },
        eventID: "event-3",
        reviewedAt: NOW,
      }),
    /idempotency conflict/,
  );
});

test("contradiction dashboard uses its semantic artifact view", () => {
  const dashboard = buildContradictionGapDashboard({
    details: fixture(),
    generatedAt: NOW,
  });
  const view = createResearchWorkspaceArtifactView(
    dashboard,
    "contradiction-gap-dashboard",
  );
  assert.equal(view.kind, "contradiction-gap");
  if (view.kind !== "contradiction-gap") return;
  assert.equal(view.relationships.length, 3);
  assert.equal(view.coverage.directContradictions, 1);
  assert(view.relationships.every((entry) => entry.evidence.length >= 2));
});
