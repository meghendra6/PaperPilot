import { test } from "node:test";
import * as assert from "node:assert/strict";

import { ResearchWorkspaceOperationCoordinator } from "../src/modules/researchWorkspace/operationCoordinator";
import {
  memberReadingProgress,
  memberUnderstanding,
  memberScreeningDecision,
} from "../src/modules/researchWorkspace/memberState";
import { createProjectOperationAdmission } from "../src/modules/researchWorkspace/operationInputs";
import type { ResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";
import {
  ResearchWorkspaceRevisionConflictError,
  type ResearchWorkspaceFileOps,
} from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import {
  ResearchWorkspaceProjectController,
  researchWorkspaceSourceRecordFromPaper,
} from "../src/modules/researchWorkspace/projectController";

class MemoryProjectFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async exists(path: string) {
    if (this.files.has(path) || this.directories.has(path)) return true;
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].some((entry) => entry.startsWith(prefix));
  }

  async readText(path: string) {
    return this.files.get(path);
  }

  async writeTextAtomic(path: string, contents: string) {
    this.files.set(path, contents);
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    if (!options?.recursive) {
      this.files.delete(path);
      this.directories.delete(path);
      return;
    }
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const entry of [...this.files.keys()]) {
      if (entry === path || entry.startsWith(prefix)) this.files.delete(entry);
    }
    for (const entry of [...this.directories]) {
      if (entry === path || entry.startsWith(prefix))
        this.directories.delete(entry);
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function setup() {
  let clock = Date.parse("2026-08-29T10:00:00.000Z");
  const ids = new Map<string, number>();
  const now = () => new Date(clock++);
  const files = new MemoryProjectFiles();
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir: "/profile/paperpilot-research-workspace",
    fileOps: files,
    now,
    idFactory: (prefix) => {
      const id = (ids.get(prefix) ?? 0) + 1;
      ids.set(prefix, id);
      return `${prefix}-${id}`;
    },
  });
  let screeningID = 0;
  return {
    files,
    repository,
    projects: new ResearchWorkspaceProjectController(repository, {
      now,
      screeningIDFactory: (prefix) => `${prefix}-${++screeningID}`,
    }),
    operations: new ResearchWorkspaceOperationCoordinator(repository, { now }),
  };
}

function paper(
  suffix: string,
  fingerprint = `fingerprint-${suffix}`,
): ResearchWorkspacePaper {
  return {
    sourceID: `zotero:1:ITEM-${suffix}:PDF-${suffix}`,
    paperKey: `zotero:1:ITEM-${suffix}:PDF-${suffix}`,
    libraryID: 1,
    itemKey: `ITEM-${suffix}`,
    itemID: 100 + suffix.charCodeAt(0),
    attachmentID: 200 + suffix.charCodeAt(0),
    attachmentKey: `PDF-${suffix}`,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: fingerprint,
      fileSize: 1_000,
      modifiedTime: 2_000,
      zoteroVersion: 3,
    },
    title: `Paper ${suffix}`,
    creators: [`Author ${suffix}`],
    year: 2025,
    doi: `10.1000/${suffix.toLowerCase()}`,
    context: `Full extracted content for paper ${suffix}.`,
    extractionQuality: "structured",
  };
}

test("paper conversion preserves exact Zotero identity and extraction lineage", () => {
  const source = researchWorkspaceSourceRecordFromPaper(
    paper("A"),
    new Date("2026-08-29T00:00:00.000Z"),
  );
  assert.equal(source.sourceID, "zotero:1:ITEM-A:PDF-A");
  assert.deepEqual(source.identity, {
    libraryID: 1,
    itemKey: "ITEM-A",
    attachmentKey: "PDF-A",
    standaloneAttachment: false,
  });
  assert.equal(source.contentFingerprint?.value, "fingerprint-A");
  assert.equal(source.extractionFingerprint?.extractor, "opendataloader-pdf");
  assert.equal(source.availability, "ready");
  assert.deepEqual(source.creators, ["Author A"]);
  assert.equal(source.year, 2025);
  assert.equal(source.doi, "10.1000/a");
});

test("project creation registers sources and idempotent membership", async () => {
  const { projects } = setup();
  const created = await projects.createProject(
    { projectID: "project-review", name: "Review" },
    [paper("A"), paper("B"), paper("A")],
  );
  assert.equal(created.members.length, 2);
  assert.deepEqual(
    created.sources.map((source) => source.identity.attachmentKey).sort(),
    ["PDF-A", "PDF-B"],
  );

  const again = await projects.addPapers("project-review", [paper("A")]);
  assert.equal(again.members.length, 2);
  assert.equal(again.members[0].reviewStatus, "unreviewed");
});

test("addPapers retries a concurrent source revision", async () => {
  const { projects, repository } = setup();
  const original = paper("A", "fingerprint-retry-v1");
  const created = await projects.createProject(
    { projectID: "project-source-retry", name: "Source retry" },
    [original],
  );
  const putSource = repository.putSource.bind(repository);
  let injected = false;
  repository.putSource = (async (source, expectedRevision) => {
    if (!injected && expectedRevision !== undefined) {
      injected = true;
      const current = await repository.getSource(source.sourceID);
      await putSource(
        { ...current!.source, title: "Concurrent metadata refresh" },
        current!.revision,
      );
    }
    return putSource(source, expectedRevision);
  }) as typeof repository.putSource;

  await projects.addPapers(created.project.projectID, [
    paper("A", "fingerprint-retry-v2"),
  ]);

  assert.equal(injected, true);
  assert.equal(
    (await repository.getSource(original.sourceID))?.source.contentFingerprint
      ?.value,
    "fingerprint-retry-v2",
  );
});

test("updating a shared source stales artifacts in every project that uses it", async () => {
  const { projects, operations, repository } = setup();
  const original = paper("A", "fingerprint-shared-v1");
  const first = await projects.createProject(
    { projectID: "project-shared-one", name: "Shared one" },
    [original],
  );
  const second = await projects.createProject(
    { projectID: "project-shared-two", name: "Shared two" },
    [original],
  );
  const firstArtifact = await operations.run({
    projectID: first.project.projectID,
    papers: [original],
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "claims-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims one",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [] }),
  });
  const secondArtifact = await operations.run({
    projectID: second.project.projectID,
    papers: [original],
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "claims-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims two",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [] }),
  });

  await projects.addPapers(first.project.projectID, [
    paper("A", "fingerprint-shared-v2"),
  ]);

  assert.equal(
    (
      await repository.getArtifact(
        first.project.projectID,
        firstArtifact.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "stale",
  );
  assert.equal(
    (
      await repository.getArtifact(
        second.project.projectID,
        secondArtifact.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "stale",
  );
});

test("source refresh invalidates an artifact admitted across the source write boundary", async () => {
  const { projects, repository } = setup();
  const original = paper("A", "fingerprint-boundary-v1");
  const created = await projects.createProject(
    { projectID: "project-source-boundary", name: "Source boundary" },
    [original],
  );
  const originalPutSource = repository.putSource.bind(repository);
  let admittedArtifactID: string | undefined;
  repository.putSource = (async (source, expectedRevision) => {
    const stored = await originalPutSource(source, expectedRevision);
    if (
      !admittedArtifactID &&
      source.contentFingerprint?.value === "fingerprint-boundary-v2"
    ) {
      const admitted = await repository.createArtifact(
        created.project.projectID,
        {
          type: "claim-ledger",
          title: "Admitted at source boundary",
          status: "complete",
          sourceIDs: [original.sourceID],
          lineage: {
            inputs: [
              {
                sourceID: original.sourceID,
                contentFingerprint: "fingerprint-boundary-v1",
                contextProjectionFingerprint: "projection-v1",
              },
            ],
            operation: "claims",
            operationVersion: "claims-v1",
            promptVersion: "claims-prompt-v1",
            parserVersion: "claims-parser-v1",
            schemaVersion: "claim-ledger-v1",
            evidenceVerifierVersion: "paperpilot-evidence-v2",
            providerMode: "local",
            runID: "run-source-boundary",
          },
          payload: { claims: [] },
        },
      );
      admittedArtifactID = admitted.artifact.artifactID;
    }
    return stored;
  }) as typeof repository.putSource;

  await projects.addPapers(created.project.projectID, [
    paper("A", "fingerprint-boundary-v2"),
  ]);

  assert(admittedArtifactID);
  assert.equal(
    (
      await repository.getArtifact(
        created.project.projectID,
        admittedArtifactID,
      )
    )?.artifact.status,
    "stale",
  );
});

test("quick projects use a deterministic source-scoped identity", async () => {
  const { projects } = setup();
  const first = await projects.ensureQuickProject([paper("B"), paper("A")]);
  const second = await projects.ensureQuickProject([paper("A"), paper("B")]);
  assert.equal(first, second);
  const home = await projects.home();
  assert.equal(home.projects.length, 1);
  assert.equal(home.projects[0].memberCount, 2);
});

test("screening decisions append history, guard revisions, and replay idempotently", async () => {
  const { projects } = setup();
  let details = await projects.createProject(
    { projectID: "project-screening", name: "Screening" },
    [paper("A")],
  );
  details = await projects.updateScreeningProtocol({
    projectID: details.project.projectID,
    expectedProjectRevision: details.projectRevision,
    inclusionCriteria: ["Relevant population"],
    exclusionCriteria: ["Duplicate report"],
  });
  const criterionID = details.project.scope!.exclusionCriteria[0].criterionID;
  const firstInput = {
    projectID: details.project.projectID,
    sourceID: details.members[0].sourceID,
    stage: "abstract" as const,
    decision: "exclude" as const,
    reasonCode: "criterion" as const,
    reason: "Duplicate report",
    criterionIDs: [criterionID],
    submissionID: "screening-submission-1",
    expectedProjectRevision: details.projectRevision,
    expectedMembersRevision: details.membersRevision,
  };
  const excluded = await projects.recordScreeningDecision(firstInput);
  assert.equal(excluded.members[0].reviewStatus, "excluded");
  assert.equal(excluded.members[0].screeningEvents?.length, 1);
  assert.equal(
    excluded.members[0].screeningEvents?.[0].protocolSnapshot[1].text,
    "Duplicate report",
  );

  const replayed = await projects.recordScreeningDecision(firstInput);
  assert.equal(replayed.membersRevision, excluded.membersRevision);
  assert.equal(replayed.members[0].screeningEvents?.length, 1);
  await assert.rejects(
    () =>
      projects.recordScreeningDecision({
        ...firstInput,
        decision: "include",
      }),
    /idempotency conflict/,
  );

  const included = await projects.recordScreeningDecision({
    projectID: excluded.project.projectID,
    sourceID: excluded.members[0].sourceID,
    stage: "full-text",
    decision: "include",
    note: "Eligible after full-text review",
    submissionID: "screening-submission-2",
    expectedProjectRevision: excluded.projectRevision,
    expectedMembersRevision: excluded.membersRevision,
  });
  assert.equal(included.members[0].reviewStatus, "included");
  assert.equal(included.members[0].exclusionReason, undefined);
  assert.equal(included.members[0].screeningEvents?.length, 2);
  assert.equal(
    included.members[0].screeningEvents?.[1].supersedesEventID,
    included.members[0].screeningEvents?.[0].eventID,
  );

  const readded = await projects.addPapers("project-screening", [paper("A")]);
  assert.equal(readded.members[0].reviewStatus, "included");
  assert.equal(readded.members[0].screeningEvents?.length, 2);
});

test("screening rejects exclusions without reasons and unknown criteria", async () => {
  const { projects } = setup();
  const details = await projects.createProject(
    { projectID: "project-screening-errors", name: "Screening errors" },
    [paper("A")],
  );
  const base = {
    projectID: details.project.projectID,
    sourceID: details.members[0].sourceID,
    stage: "abstract" as const,
    submissionID: "screening-submission-error",
    expectedProjectRevision: details.projectRevision,
    expectedMembersRevision: details.membersRevision,
  };
  await assert.rejects(
    () =>
      projects.recordScreeningDecision({
        ...base,
        decision: "exclude",
      }),
    /requires a reason/,
  );
  await assert.rejects(
    () =>
      projects.recordScreeningDecision({
        ...base,
        decision: "exclude",
        reasonCode: "criterion",
        reason: "Unknown criterion",
        criterionIDs: ["criterion-unknown"],
      }),
    /Unknown or disabled screening criterion/,
  );
  const unchanged = await projects.details(details.project.projectID);
  assert.equal(unchanged.membersRevision, details.membersRevision);
  assert.equal(unchanged.members[0].screeningEvents, undefined);
});

test("successful project operations persist completed runs and scoped artifact history", async () => {
  const { operations, repository } = setup();
  const first = await operations.run({
    papers: [paper("A")],
    operation: "claim-ledger",
    operationVersion: "claim-ledger-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claim–Evidence Ledger",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [{ text: "Claim A" }] }),
  });
  assert.equal(first.artifact.artifact.version, 1);
  assert.equal(first.artifact.artifact.status, "complete");
  assert.equal(first.run.run.status, "completed");
  assert.equal(first.run.run.artifactID, first.artifact.artifact.artifactID);
  assert.equal(
    first.artifact.artifact.lineage.inputs[0].contentFingerprint,
    "fingerprint-A",
  );

  const second = await operations.run({
    projectID: first.projectID,
    papers: [paper("A")],
    operation: "claim-ledger",
    operationVersion: "claim-ledger-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claim–Evidence Ledger",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [{ text: "Claim A2" }] }),
  });
  assert.equal(second.artifact.artifact.version, 2);
  assert.equal(
    second.artifact.artifact.supersedesArtifactID,
    first.artifact.artifact.artifactID,
  );
  assert.equal(
    (
      await repository.getArtifact(
        first.projectID,
        first.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "superseded",
  );
});

test("artifact versions do not supersede the same operation for a different source", async () => {
  const { operations, projects } = setup();
  const created = await projects.createProject(
    { projectID: "project-scope", name: "Scoped history" },
    [paper("A"), paper("B")],
  );
  const first = await operations.run({
    projectID: created.project.projectID,
    sourcesPrepared: true,
    papers: [paper("A")],
    operation: "critical-read",
    operationVersion: "critical-read-v1",
    artifactType: "critical-read",
    artifactTitle: "Critical Read",
    providerMode: "codex_cli",
    execute: async () => ({ paper: "A" }),
  });
  const second = await operations.run({
    projectID: created.project.projectID,
    sourcesPrepared: true,
    papers: [paper("B")],
    operation: "critical-read",
    operationVersion: "critical-read-v1",
    artifactType: "critical-read",
    artifactTitle: "Critical Read",
    providerMode: "codex_cli",
    execute: async () => ({ paper: "B" }),
  });
  assert.equal(first.artifact.artifact.version, 1);
  assert.equal(second.artifact.artifact.version, 1);
  assert.equal(second.artifact.artifact.supersedesArtifactID, undefined);
});

test("operation failures retain a redacted failed run without a fake artifact", async () => {
  const { operations, repository } = setup();
  let projectID = "";
  await assert.rejects(async () => {
    try {
      await operations.run({
        papers: [paper("A")],
        operation: "critical-read",
        operationVersion: "critical-read-v1",
        artifactType: "critical-read",
        artifactTitle: "Critical Read",
        providerMode: "claude_code",
        execute: async () => {
          throw new Error(
            "Provider failed at /private/var/folders/secret/paper.pdf and /Volumes/research/data.json",
          );
        },
      });
    } finally {
      const projects = await repository.listProjects();
      projectID = projects[0]?.projectID ?? "";
    }
  }, /Provider failed/);
  const runs = await repository.listRuns(projectID);
  const artifacts = await repository.listArtifacts(projectID);
  assert.equal(runs.runs.length, 1);
  assert.equal(runs.runs[0].status, "failed");
  assert.match(runs.runs[0].safeError ?? "", /\[local-path\]/);
  assert.equal(runs.runs[0].safeError?.includes("/private/var"), false);
  assert.equal(runs.runs[0].safeError?.includes("/Volumes/research"), false);
  assert.equal(artifacts.artifacts.length, 0);
});

test("pre-cancelled operations are recorded as cancelled and never execute", async () => {
  const { operations, repository } = setup();
  const controller = new AbortController();
  controller.abort();
  let executed = false;
  await assert.rejects(
    operations.run({
      papers: [paper("A")],
      operation: "paper-to-code",
      operationVersion: "paper-to-code-v1",
      artifactType: "paper-to-code",
      artifactTitle: "Paper-to-Code",
      providerMode: "gemini_cli",
      signal: controller.signal,
      execute: async () => {
        executed = true;
        return {};
      },
    }),
    /Cancelled/,
  );
  const project = (await repository.listProjects())[0];
  const runs = await repository.listRuns(project.projectID);
  assert.equal(executed, false);
  assert.equal(runs.runs[0].status, "cancelled");
});

test("excluded sources are rejected before analysis and cannot create a complete artifact", async () => {
  const { projects, operations, repository } = setup();
  const source = paper("A");
  let details = await projects.createProject(
    { projectID: "excluded-run", name: "Excluded" },
    [source],
  );
  details = await projects.recordScreeningDecision({
    projectID: details.project.projectID,
    sourceID: source.sourceID,
    stage: "abstract",
    decision: "exclude",
    reasonCode: "other",
    reason: "Outside scope",
    submissionID: "exclude-1",
    expectedProjectRevision: details.projectRevision,
    expectedMembersRevision: details.membersRevision,
  });
  let executions = 0;
  await assert.rejects(
    operations.run({
      projectID: details.project.projectID,
      papers: [source],
      sourcesPrepared: true,
      operation: "claim-ledger",
      operationVersion: "v1",
      artifactType: "claim-ledger",
      artifactTitle: "Claims",
      providerMode: "local",
      execute: async () => {
        executions++;
        return { claims: [] };
      },
    }),
    /source changed/,
  );
  assert.equal(executions, 0);
  assert.equal(
    (await repository.listArtifacts(details.project.projectID)).artifacts
      .length,
    0,
  );
});

test("reading and understanding updates preserve screening history and active semantic inputs", async () => {
  const { projects, operations, repository } = setup();
  const source = paper("A");
  let details = await projects.createProject(
    { projectID: "reading", name: "Reading" },
    [source],
  );
  details = await projects.recordScreeningDecision({
    projectID: "reading",
    sourceID: source.sourceID,
    stage: "abstract",
    decision: "include",
    submissionID: "include-1",
    expectedProjectRevision: details.projectRevision,
    expectedMembersRevision: details.membersRevision,
  });
  const events = JSON.stringify(details.members[0].screeningEvents);
  const admission = createProjectOperationAdmission(
    details,
    [source],
    { question: "What is the result?" },
    [],
  );
  const completed = await operations.run({
    projectID: "reading",
    papers: [source],
    sourcesPrepared: true,
    admission,
    operation: "claim-ledger",
    operationVersion: "v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims",
    providerMode: "local",
    execute: async () => {
      await projects.updateReadingState({
        projectID: "reading",
        sourceID: source.sourceID,
        readingProgress: "read",
        understanding: "needs-review",
      });
      return { claims: [] };
    },
  });
  const current = await projects.details("reading");
  assert.equal(current.members[0].readingProgress, "read");
  assert.equal(current.members[0].understanding, "needs-review");
  assert.equal(memberScreeningDecision(current.members[0]), "include");
  assert.equal(JSON.stringify(current.members[0].screeningEvents), events);
  assert.equal(completed.artifact.artifact.status, "complete");
  await projects.updateReadingState({
    projectID: "reading",
    sourceID: source.sourceID,
    understanding: "understood",
  });
  assert.equal(
    (
      await repository.getArtifact(
        "reading",
        completed.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "complete",
  );
});

test("legacy progress is projected without inventing reading or rewriting screening", () => {
  const base = {
    sourceID: "S",
    role: "candidate" as const,
    addedAt: "2026-09-07",
    updatedAt: "2026-09-07",
  };
  for (const reviewStatus of [
    "included",
    "maybe",
    "excluded",
    "understood",
  ] as const) {
    const member = { ...base, reviewStatus };
    assert.equal(memberReadingProgress(member), "unreviewed");
    assert.equal(
      memberUnderstanding(member),
      reviewStatus === "understood" ? "understood" : "unknown",
    );
  }
  for (const reviewStatus of ["skimmed", "read", "up-next"] as const)
    assert.equal(
      memberReadingProgress({ ...base, reviewStatus }),
      reviewStatus,
    );
});

test("candidate inbox saves metadata without fake sources and binds exactly once after interrupted membership", async () => {
  const { projects, repository, files } = setup();
  await projects.createProject({
    projectID: "candidate-project",
    name: "Candidates",
  });
  const input = {
    projectID: "candidate-project",
    candidateID: "candidate-A",
    metadata: { title: "Promising study", doi: "10.1000/example" },
    provenance: {
      kind: "discovery" as const,
      url: "https://example.org/study",
    },
    userNote: "Compare its method",
  };
  const first = await projects.saveCandidate(input);
  assert.deepEqual(await projects.saveCandidate(input), first);
  assert.equal((await projects.details("candidate-project")).members.length, 0);
  assert.equal(
    (await repository.getCandidates("candidate-project")).candidates.length,
    1,
  );
  const write = files.writeTextAtomic.bind(files);
  let fail = true;
  files.writeTextAtomic = async (path, contents) => {
    if (fail && path.endsWith("/members.json")) {
      fail = false;
      throw new Error("Interrupted member write");
    }
    return write(path, contents);
  };
  await assert.rejects(
    projects.bindCandidate({
      projectID: "candidate-project",
      candidateID: first.candidateID,
      paper: paper("A"),
    }),
    /Interrupted member write/,
  );
  const persisted = await repository.getCandidates("candidate-project");
  assert.equal(persisted.candidates[0].binding?.sourceID, paper("A").sourceID);
  await repository.recoverStartup();
  await projects.bindCandidate({
    projectID: "candidate-project",
    candidateID: first.candidateID,
    paper: paper("A"),
  });
  const details = await projects.details("candidate-project");
  assert.equal(details.members.length, 1);
  assert.equal(details.members[0].sourceID, paper("A").sourceID);
  assert.equal(
    (await repository.exportProject("candidate-project")).candidates?.[0]
      .userNote,
    input.userNote,
  );
  await assert.rejects(
    projects.bindCandidate({
      projectID: "candidate-project",
      candidateID: first.candidateID,
      paper: paper("B"),
    }),
    /different PDF/,
  );
  await repository.deleteProject("candidate-project");
  assert.equal(
    files.files.has(repository.getCandidatesPath("candidate-project")),
    false,
  );
});

test("future or malformed candidate inbox is preserved and never replaced by empty data", async () => {
  const { projects, repository, files } = setup();
  await projects.createProject({
    projectID: "future-candidates",
    name: "Future",
  });
  const path = repository.getCandidatesPath("future-candidates");
  const raw = JSON.stringify({
    schemaVersion: 99,
    revision: 2,
    projectID: "future-candidates",
    candidates: [],
  });
  files.files.set(path, raw);
  await assert.rejects(
    repository.getCandidates("future-candidates"),
    /version/,
  );
  const recovered = await repository.recoverStartup();
  assert(
    recovered.warnings.some((warning) =>
      warning.includes("Candidate inbox recovery failed"),
    ),
  );
  assert.equal(files.files.get(path), raw);
});

test("project question changes during execution reject completion and later changes stale completed results", async () => {
  const { projects, operations, repository } = setup();
  const source = paper("A");
  await projects.createProject(
    { projectID: "question-scope", name: "Question", researchQuestion: "Q1" },
    [source],
  );
  const operation = {
    projectID: "question-scope",
    papers: [source],
    sourcesPrepared: true,
    operation: "claim-ledger",
    operationVersion: "v1",
    artifactType: "claim-ledger" as const,
    artifactTitle: "Claims",
    providerMode: "local" as const,
  };
  await assert.rejects(
    operations.run({
      ...operation,
      execute: async () => {
        await projects.updateProject("question-scope", {
          researchQuestion: "Q2",
        });
        return { claims: [] };
      },
    }),
    /question, criteria, or analysis scope changed/,
  );
  const complete = await operations.run({
    ...operation,
    execute: async () => ({ claims: [] }),
  });
  await projects.updateProject("question-scope", { researchQuestion: "Q3" });
  assert.equal(
    (
      await repository.getArtifact(
        "question-scope",
        complete.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "stale",
  );
});

test("screening protocol updates stale completed analysis and its dependents", async () => {
  const { projects, operations, repository } = setup();
  const source = paper("PROTOCOL");
  const details = await projects.createProject(
    { projectID: "protocol-stale", name: "Protocol", researchQuestion: "Q1" },
    [source],
  );
  const base = {
    projectID: "protocol-stale",
    papers: [source],
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "v1",
    artifactType: "claim-ledger" as const,
    artifactTitle: "Claims",
    providerMode: "local" as const,
  };
  const first = await operations.run({
    ...base,
    execute: async () => ({ claims: [] }),
  });
  const current = await projects.details("protocol-stale");
  const dependent = await operations.run({
    ...base,
    operation: "derived-claims",
    admission: createProjectOperationAdmission(
      current,
      [source],
      { question: "Q1" },
      [first.artifact.artifact],
    ),
    execute: async () => ({ claims: [] }),
  });
  const latest = await projects.details("protocol-stale");
  await projects.updateScreeningProtocol({
    projectID: "protocol-stale",
    expectedProjectRevision: latest.projectRevision,
    inclusionCriteria: ["Human participants"],
    exclusionCriteria: [],
  });
  assert.equal(
    (
      await repository.getArtifact(
        "protocol-stale",
        first.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "stale",
  );
  assert.equal(
    (
      await repository.getArtifact(
        "protocol-stale",
        dependent.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "stale",
  );
  assert.equal(details.members[0].reviewStatus, "unreviewed");
});

test("rejecting a stale captured batch cannot roll back durable source fingerprints", async () => {
  const { projects, operations, repository } = setup();
  const current = paper("CURRENT");
  await projects.createProject(
    { projectID: "source-admission", name: "Source admission" },
    [current],
  );
  const completed = await operations.run({
    projectID: "source-admission",
    papers: [current],
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims",
    providerMode: "local",
    execute: async () => ({ claims: [] }),
  });
  const before = await repository.getSource(current.sourceID);
  const guarded = new ResearchWorkspaceProjectController(repository, {
    validateSource: async (source) => {
      if (source.contentFingerprint.value !== current.contentFingerprint.value)
        throw new Error("Captured PDF changed");
    },
  });
  const stale = {
    ...current,
    contentFingerprint: {
      ...current.contentFingerprint,
      value: "old-captured-fingerprint",
    },
  };
  await assert.rejects(
    guarded.addPapers("source-admission", [stale]),
    /Captured PDF changed/,
  );
  assert.deepEqual(await repository.getSource(current.sourceID), before);
  assert.equal(
    (
      await repository.getArtifact(
        "source-admission",
        completed.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "complete",
  );
});

for (const operation of ["add-papers", "bind-candidate"] as const)
  test(`source refresh during ${operation} CAS cannot be overwritten by stale captured content`, async () => {
    const { projects, repository } = setup();
    const captured = paper("A", "old");
    await projects.createProject(
      { projectID: "source-cas", name: "CAS race" },
      [captured],
    );
    if (operation === "bind-candidate")
      await projects.saveCandidate({
        projectID: "source-cas",
        candidateID: "candidate-cas",
        metadata: { title: "Paper" },
        provenance: { kind: "manual" },
      });
    let actual = "old";
    let validations = 0;
    let interleave = true;
    const guarded = new ResearchWorkspaceProjectController(repository, {
      validateSource: async (source) => {
        validations++;
        if (source.contentFingerprint.value !== actual)
          throw new Error("The captured PDF changed");
      },
    });
    const putSource = repository.putSource.bind(repository);
    repository.putSource = async (record, revision) => {
      if (interleave) {
        interleave = false;
        actual = "new";
        const current = await repository.getSource(captured.sourceID);
        assert(current);
        await putSource(
          researchWorkspaceSourceRecordFromPaper(paper("A", "new"), new Date()),
          current.revision,
        );
      }
      return putSource(record, revision);
    };
    const execute = async () => {
      if (operation === "add-papers")
        return guarded.addPapers("source-cas", [captured]);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await guarded.bindCandidate({
            projectID: "source-cas",
            candidateID: "candidate-cas",
            paper: captured,
          });
        } catch (error) {
          if (
            !(error instanceof ResearchWorkspaceRevisionConflictError) ||
            attempt === 2
          )
            throw error;
        }
      }
      throw new Error("Candidate CAS retry limit exceeded");
    };
    await assert.rejects(execute, /captured PDF changed/);
    assert.equal(
      (await repository.getSource(captured.sourceID))?.source.contentFingerprint
        ?.value,
      "new",
    );
    assert(
      validations >= 2,
      "every CAS retry must validate its captured source again",
    );
    if (operation === "bind-candidate")
      assert.equal(
        (await repository.getCandidates("source-cas")).candidates[0].binding,
        undefined,
      );
  });
