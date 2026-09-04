import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
  ResearchWorkspaceRevisionConflictError,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceArtifactLineage,
  type ResearchWorkspaceFileOps,
  type ResearchWorkspaceSourceRecord,
} from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import { parseResearchWorkspaceMembersFile } from "../src/modules/researchWorkspace/persistence/validation";

class MemoryWorkspaceFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly writes: string[] = [];
  failWrite: ((path: string) => boolean) | undefined;

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
    if (this.failWrite?.(path))
      throw new Error(`Injected write failure: ${path}`);
    this.writes.push(path);
    this.files.set(path, contents);
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    if (!options?.recursive) {
      this.files.delete(path);
      this.directories.delete(path);
      return;
    }
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) this.files.delete(key);
    }
    for (const key of [...this.directories]) {
      if (key === path || key.startsWith(prefix)) this.directories.delete(key);
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function repository(files = new MemoryWorkspaceFiles()) {
  let clock = Date.parse("2026-08-29T00:00:00.000Z");
  const ids = new Map<string, number>();
  const warnings: string[] = [];
  return {
    files,
    warnings,
    repository: new ResearchWorkspaceProjectRepository({
      rootDir: "/profile/paperpilot-research-workspace",
      fileOps: files,
      now: () => new Date(clock++),
      idFactory: (prefix) => {
        const value = (ids.get(prefix) ?? 0) + 1;
        ids.set(prefix, value);
        return `${prefix}-${value}`;
      },
      warn: (message) => warnings.push(message),
    }),
  };
}

function source(
  suffix: string,
  fingerprint = `fingerprint-${suffix}`,
): ResearchWorkspaceSourceRecord {
  return {
    sourceID: `zotero:1:ITEM-${suffix}:PDF-${suffix}`,
    identity: {
      libraryID: 1,
      itemKey: `ITEM-${suffix}`,
      attachmentKey: `PDF-${suffix}`,
      standaloneAttachment: false,
    },
    title: `Paper ${suffix}`,
    runtimeItemID: 100 + suffix.charCodeAt(0),
    runtimeAttachmentID: 200 + suffix.charCodeAt(0),
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: fingerprint,
      zoteroVersion: 1,
    },
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: "2026-08-29T00:00:00.000Z",
    lastExtractedAt: "2026-08-29T00:00:00.000Z",
  };
}

function lineage(
  sources: ResearchWorkspaceSourceRecord[],
  runID = "run-1",
): ResearchWorkspaceArtifactLineage {
  return {
    inputs: sources.map((entry) => ({
      sourceID: entry.sourceID,
      contentFingerprint: entry.contentFingerprint!.value,
      contextProjectionFingerprint: `projection-${entry.identity.itemKey}`,
    })),
    operation: "claims",
    operationVersion: "1",
    promptVersion: "1",
    parserVersion: "1",
    evidenceVerifierVersion: "paperpilot-evidence-v2",
    providerMode: "codex_cli",
    model: "gpt-5.6-terra",
    runID,
  };
}

function injectConcurrentArtifactRevision(
  setup: ReturnType<typeof repository>,
  projectID: string,
  artifactID: string,
  payload: unknown,
) {
  const originalList = setup.repository.listArtifacts.bind(setup.repository);
  const originalUpdate = setup.repository.updateArtifact.bind(setup.repository);
  let injectedAfterList = false;
  let injectedBeforeLegacyUpdate = false;

  setup.repository.listArtifacts = (async (requestedProjectID: string) => {
    const listed = await originalList(requestedProjectID);
    if (!injectedAfterList && requestedProjectID === projectID) {
      injectedAfterList = true;
      const current = await setup.repository.getArtifact(projectID, artifactID);
      assert(current);
      await originalUpdate(
        projectID,
        artifactID,
        current.revision,
        (artifact: ResearchWorkspaceArtifact) => ({
          ...artifact,
          payload: structuredClone(payload),
        }),
        false,
      );
    }
    return listed;
  }) as typeof setup.repository.listArtifacts;

  setup.repository.updateArtifact = (async (
    requestedProjectID: string,
    requestedArtifactID: string,
    expectedRevision: number,
    mutate: (artifact: ResearchWorkspaceArtifact) => ResearchWorkspaceArtifact,
    syncCatalog = true,
  ) => {
    if (
      injectedAfterList &&
      !injectedBeforeLegacyUpdate &&
      requestedProjectID === projectID &&
      requestedArtifactID === artifactID
    ) {
      injectedBeforeLegacyUpdate = true;
      await originalUpdate(
        projectID,
        artifactID,
        expectedRevision,
        (artifact: ResearchWorkspaceArtifact) => ({
          ...artifact,
          payload: { concurrentReview: "newer-than-stale-snapshot" },
        }),
        false,
      );
    }
    return originalUpdate(
      requestedProjectID,
      requestedArtifactID,
      expectedRevision,
      mutate,
      syncCatalog,
    );
  }) as typeof setup.repository.updateArtifact;
}

test("reading an empty project store performs no durable write", async () => {
  const setup = repository();
  assert.deepEqual(await setup.repository.listProjects(), []);
  assert.equal((await setup.repository.getCatalog()).revision, 0);
  assert.deepEqual(setup.files.writes, []);
});

test("a project left without members.json repairs itself on open", async () => {
  const setup = repository();
  setup.files.failWrite = (path) => path.endsWith("members.json");

  await assert.rejects(
    setup.repository.createProject({
      projectID: "project-partial-create",
      name: "Partial create recovery",
    }),
    /Injected write failure.*members\.json/,
  );
  setup.files.failWrite = undefined;

  const recovered = await setup.repository.getProject("project-partial-create");
  assert.deepEqual(recovered.members, []);
  assert.equal(recovered.membersRevision, 0);
  assert.match(setup.warnings[0], /restored an empty revision-0 membership/);
});

test("new artifacts are validated before their first durable write", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-artifact-validation",
    name: "Artifact validation",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  await assert.rejects(
    setup.repository.createArtifact(project.project.projectID, {
      type: "claim-ledger",
      title: "Broken source scope",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: { ...lineage([], "run-broken-scope") },
      payload: {},
    }),
    /sourceIDs must match lineage source inputs/,
  );
  await assert.rejects(
    setup.repository.createArtifact(project.project.projectID, {
      artifactID: "artifact-self",
      type: "claim-ledger",
      title: "Self dependency",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-self-dependency"),
        artifactInputs: [
          {
            artifactID: "artifact-self",
            artifactType: "claim-ledger",
            version: 1,
            updatedAt: "2026-08-29T00:00:00.000Z",
            payloadFingerprint: "artifact-payload-self",
          },
        ],
      },
      payload: {},
    }),
    /cannot depend on itself/,
  );
  assert.equal(
    (await setup.repository.listArtifacts(project.project.projectID)).artifacts
      .length,
    0,
  );
});

test("screening histories round-trip and reject broken provenance", () => {
  const valid = {
    schemaVersion: RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
    revision: 1,
    projectID: "project-screening",
    members: [
      {
        sourceID: "zotero:1:ITEM-A:PDF-A",
        role: "candidate",
        reviewStatus: "included",
        addedAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T01:00:00.000Z",
        screeningEvents: [
          {
            eventID: "screening-event-1",
            submissionID: "screening-submission-1",
            sourceID: "zotero:1:ITEM-A:PDF-A",
            stage: "full-text",
            decision: "include",
            actor: "local-user",
            protocolFingerprint: "screening-protocol-12345678",
            protocolSnapshot: [],
            sourceSnapshot: {
              title: "Paper A",
              availability: "ready",
              contentFingerprint: "fingerprint-A",
            },
            decidedAt: "2026-08-30T01:00:00.000Z",
          },
        ],
      },
    ],
  };
  const serialized = JSON.stringify(valid);
  assert.deepEqual(
    parseResearchWorkspaceMembersFile(JSON.parse(serialized)),
    valid,
  );

  const foreignSource = JSON.parse(serialized);
  foreignSource.members[0].screeningEvents[0].sourceID =
    "zotero:1:ITEM-B:PDF-B";
  assert.throws(
    () => parseResearchWorkspaceMembersFile(foreignSource),
    /does not match its member/,
  );

  const invalidSupersedes = JSON.parse(serialized);
  invalidSupersedes.members[0].screeningEvents[0].supersedesEventID =
    "screening-event-missing";
  assert.throws(
    () => parseResearchWorkspaceMembersFile(invalidSupersedes),
    /not earlier in the history/,
  );

  const duplicateSubmission = JSON.parse(serialized);
  const second = structuredClone(duplicateSubmission.members[0]);
  second.sourceID = "zotero:1:ITEM-B:PDF-B";
  second.screeningEvents[0].eventID = "screening-event-2";
  second.screeningEvents[0].sourceID = second.sourceID;
  duplicateSubmission.members.push(second);
  assert.throws(
    () => parseResearchWorkspaceMembersFile(duplicateSubmission),
    /Duplicate submission/,
  );
});

test("project updates are revision guarded and catalog stays lightweight", async () => {
  const setup = repository();
  const created = await setup.repository.createProject({
    projectID: "project-alpha",
    name: "Alpha review",
    researchQuestion: "Does A improve B?",
  });
  assert.equal(created.projectRevision, 1);
  assert.equal(created.membersRevision, 1);
  assert.deepEqual(await setup.repository.listProjects(), [
    {
      projectID: "project-alpha",
      name: "Alpha review",
      updatedAt: created.project.updatedAt,
      memberCount: 0,
      staleArtifactCount: 0,
      dueMasteryReviewCount: 0,
    },
  ]);

  const updated = await setup.repository.updateProject(
    "project-alpha",
    created.projectRevision,
    (project) => ({ ...project, name: "Renamed review" }),
  );
  assert.equal(updated.revision, 2);
  assert.equal(updated.project.name, "Renamed review");
  await assert.rejects(
    () =>
      setup.repository.updateProject(
        "project-alpha",
        created.projectRevision,
        (project) => project,
      ),
    ResearchWorkspaceRevisionConflictError,
  );

  const catalogText = setup.files.files.get(setup.repository.catalogPath)!;
  assert.equal(catalogText.includes("artifactIDs"), false);
  assert.equal(catalogText.includes("payload"), false);
});

test("member persistence requires known sources and exclusion reasons", async () => {
  const setup = repository();
  const created = await setup.repository.createProject({
    projectID: "project-members",
    name: "Member review",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);

  const members = await setup.repository.addMembers(
    "project-members",
    created.membersRevision,
    [{ sourceID: sourceA.sourceID, role: "seed" }],
  );
  assert.equal(members.revision, 2);
  assert.equal(members.members[0].role, "seed");
  assert.equal(members.members[0].reviewStatus, "unreviewed");

  await assert.rejects(
    () =>
      setup.repository.addMembers("project-members", members.revision, [
        { sourceID: "zotero:1:MISSING:PDF" },
      ]),
    /Source .* was not found/,
  );
  await assert.rejects(
    () =>
      setup.repository.addMembers("project-members", members.revision, [
        {
          sourceID: sourceA.sourceID,
          reviewStatus: "excluded",
        },
      ]),
    /exclusion reason/,
  );
  assert.equal(
    (await setup.repository.getProject("project-members")).members[0]
      .reviewStatus,
    "unreviewed",
  );
});

test("artifact history versions, supersedes, and marks source changes stale", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-artifacts",
    name: "Artifact review",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    "project-artifacts",
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );

  const first = await setup.repository.createArtifact("project-artifacts", {
    artifactID: "artifact-first",
    type: "claim-ledger",
    title: "Claims",
    status: "complete",
    sourceIDs: [sourceA.sourceID],
    lineage: lineage([sourceA]),
    payload: { claims: ["first"] },
    completedAt: "2026-08-29T00:01:00.000Z",
  });
  const second = await setup.repository.createArtifact("project-artifacts", {
    artifactID: "artifact-second",
    type: "claim-ledger",
    title: "Claims rerun",
    status: "complete",
    sourceIDs: [sourceA.sourceID],
    lineage: lineage([sourceA], "run-2"),
    payload: { claims: ["second"] },
    completedAt: "2026-08-29T00:02:00.000Z",
  });
  assert.equal(first.artifact.version, 1);
  assert.equal(second.artifact.version, 2);
  assert.equal(second.artifact.supersedesArtifactID, "artifact-first");
  assert.equal(
    (await setup.repository.getArtifact("project-artifacts", "artifact-first"))!
      .artifact.status,
    "superseded",
  );

  const changed = await setup.repository.markArtifactsStaleForSource({
    projectID: "project-artifacts",
    sourceID: sourceA.sourceID,
    contentFingerprint: "replacement-fingerprint",
  });
  assert.deepEqual(changed, ["artifact-second"]);
  const latest = await setup.repository.getArtifact(
    "project-artifacts",
    "artifact-second",
  );
  assert.equal(latest!.artifact.status, "stale");
  assert.match(latest!.artifact.staleReasons![0], /source-content-changed/);
  assert.equal(
    (await setup.repository.listProjects())[0].staleArtifactCount,
    1,
  );
});

test("artifact history limit prunes the oldest unreferenced superseded version", async () => {
  const setup = repository();
  const preferences = await setup.repository.getPreferences();
  await setup.repository.updatePreferences(preferences.revision, (current) => ({
    ...current,
    artifactHistoryLimit: 2,
  }));
  const project = await setup.repository.createProject({
    projectID: "project-history-limit",
    name: "History limit",
  });
  const sourceA = source("H");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  for (const artifactID of ["history-one", "history-two", "history-three"]) {
    await setup.repository.createArtifact(project.project.projectID, {
      artifactID,
      type: "claim-ledger",
      title: artifactID,
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], `run-${artifactID}`),
      payload: { artifactID },
    });
  }

  assert.equal(
    await setup.repository.getArtifact(
      project.project.projectID,
      "history-one",
    ),
    undefined,
  );
  assert.deepEqual(
    (await setup.repository.listArtifacts(project.project.projectID)).artifacts
      .map((artifact) => artifact.artifactID)
      .sort(),
    ["history-three", "history-two"],
  );
});

test("an artifact update never rewrites another project's durable files", async () => {
  const setup = repository();
  await setup.repository.createProject({
    projectID: "project-one",
    name: "One",
  });
  await setup.repository.createProject({
    projectID: "project-two",
    name: "Two",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  const one = await setup.repository.getProject("project-one");
  await setup.repository.addMembers("project-one", one.membersRevision, [
    { sourceID: sourceA.sourceID },
  ]);
  const artifact = await setup.repository.createArtifact("project-one", {
    artifactID: "artifact-one",
    type: "synthesis",
    title: "Synthesis",
    status: "complete",
    sourceIDs: [sourceA.sourceID],
    lineage: lineage([sourceA]),
    payload: { text: "before" },
  });

  setup.files.writes.splice(0);
  await setup.repository.updateArtifact(
    "project-one",
    "artifact-one",
    artifact.revision,
    (current) => ({ ...current, payload: { text: "after" } }),
  );
  assert.equal(
    setup.files.writes.some((path) => path.includes("project-project-two")),
    false,
  );
  assert.deepEqual(
    setup.files.writes.map((path) => path.split("/").pop()).sort(),
    ["artifact-artifact-one.json", "catalog-v1.json"],
  );
});

test("an unchanged artifact update is a true no-op with a moving clock", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-artifact-noop",
    name: "No-op update",
  });
  const sourceA = source("N");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const upstream = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-noop-upstream",
      type: "claim-ledger",
      title: "Claims",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA]),
      payload: { claims: [] },
    },
  );
  const dependent = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-noop-dependent",
      type: "synthesis",
      title: "Synthesis",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-dependent"),
        operation: "project-synthesis",
        artifactInputs: [
          {
            artifactID: upstream.artifact.artifactID,
            artifactType: upstream.artifact.type,
            version: upstream.artifact.version,
            updatedAt: upstream.artifact.updatedAt,
            payloadFingerprint: "payload-fingerprint",
          },
        ],
      },
      payload: { text: "unchanged" },
    },
  );
  setup.files.writes.splice(0);

  const result = await setup.repository.updateArtifact(
    project.project.projectID,
    upstream.artifact.artifactID,
    upstream.revision,
    (current) => current,
  );

  assert.equal(result.revision, upstream.revision);
  assert.deepEqual(setup.files.writes, []);
  assert.equal(
    (
      await setup.repository.getArtifact(
        project.project.projectID,
        dependent.artifact.artifactID,
      )
    )?.artifact.status,
    "complete",
  );
});

test("startup recovery marks only active persisted runs interrupted", async () => {
  const setup = repository();
  await setup.repository.createProject({
    projectID: "project-runs",
    name: "Run recovery",
  });
  await setup.repository.createRun("project-runs", {
    runID: "run-active",
    owner: { kind: "project", projectID: "project-runs" },
    projectID: "project-runs",
    operation: "evidence-matrix",
    operationVersion: "1",
    sourceSnapshot: [],
    status: "running",
    progress: { phase: "rows", completed: 1, total: 3 },
    startedAt: "2026-08-29T00:00:00.000Z",
  });
  await setup.repository.createRun("project-runs", {
    runID: "run-complete",
    owner: { kind: "project", projectID: "project-runs" },
    projectID: "project-runs",
    operation: "synthesis",
    operationVersion: "1",
    sourceSnapshot: [],
    status: "completed",
    progress: { phase: "done", completed: 1, total: 1 },
    completedAt: "2026-08-29T00:00:01.000Z",
  });

  const recovered = await setup.repository.recoverInterruptedRuns();
  assert.deepEqual(recovered.recovered, ["run-active"]);
  assert.equal(
    (await setup.repository.getRun("project-runs", "run-active"))!.run.status,
    "interrupted",
  );
  assert.equal(
    (await setup.repository.getRun("project-runs", "run-complete"))!.run.status,
    "completed",
  );
});

test("startup recovery repairs a missing catalog only when project data exists", async () => {
  const empty = repository();
  const emptyRecovery = await empty.repository.recoverStartup();
  assert.equal(emptyRecovery.repairedCatalog, false);
  assert.deepEqual(empty.files.writes, []);

  const setup = repository();
  await setup.repository.createProject({
    projectID: "project-startup-repair",
    name: "Startup repair",
  });
  setup.files.files.delete(setup.repository.catalogPath);
  setup.files.writes.splice(0);
  const recovery = await setup.repository.recoverStartup();
  assert.equal(recovery.repairedCatalog, true);
  assert.deepEqual(
    (await setup.repository.listProjects()).map((entry) => entry.projectID),
    ["project-startup-repair"],
  );
  assert.deepEqual(setup.files.writes, [setup.repository.catalogPath]);
});

test("catalog repair discovers a project left behind by a catalog failure", async () => {
  const setup = repository();
  setup.files.failWrite = (path) => path.endsWith("catalog-v1.json");
  await assert.rejects(
    () =>
      setup.repository.createProject({
        projectID: "project-repair",
        name: "Recover me",
      }),
    /Injected write failure/,
  );
  assert.equal(
    setup.files.files.has(setup.repository.getProjectPath("project-repair")),
    true,
  );
  setup.files.failWrite = undefined;
  const repaired = await setup.repository.repairCatalog();
  assert.deepEqual(
    repaired.catalog.projects.map((entry) => entry.projectID),
    ["project-repair"],
  );
});

test("startup recovery re-links valid orphan artifact and run files", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-orphan-repair",
    name: "Orphan repair",
  });
  const sourceA = source("O");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  setup.files.failWrite = (path) => path.endsWith("project.json");
  await assert.rejects(
    () =>
      setup.repository.createArtifact(project.project.projectID, {
        artifactID: "artifact-orphaned",
        type: "claim-ledger",
        title: "Finished but unlinked",
        status: "complete",
        sourceIDs: [sourceA.sourceID],
        lineage: lineage([sourceA]),
        payload: { claims: [] },
      }),
    /Injected write failure/,
  );
  await assert.rejects(
    () =>
      setup.repository.createRun(project.project.projectID, {
        runID: "run-orphaned",
        owner: { kind: "project", projectID: project.project.projectID },
        projectID: project.project.projectID,
        operation: "claims",
        operationVersion: "1",
        sourceSnapshot: [],
        status: "completed",
        progress: { phase: "done", completed: 1, total: 1 },
      }),
    /Injected write failure/,
  );
  setup.files.failWrite = undefined;

  const recovery = await setup.repository.recoverStartup();
  const repaired = await setup.repository.getProject(project.project.projectID);
  assert.equal(recovery.repairedCatalog, true);
  assert.deepEqual(repaired.project.artifactIDs, ["artifact-orphaned"]);
  assert.deepEqual(repaired.project.runIDs, ["run-orphaned"]);
  assert.deepEqual(
    (
      await setup.repository.listArtifacts(project.project.projectID)
    ).artifacts.map((artifact) => artifact.artifactID),
    ["artifact-orphaned"],
  );
});

test("startup recovery quarantines an unreadable orphan artifact", async () => {
  const setup = repository();
  await setup.repository.createProject({
    projectID: "project-orphan-quarantine",
    name: "Orphan quarantine",
  });
  const path = setup.repository.getArtifactPath(
    "project-orphan-quarantine",
    "artifact-broken-orphan",
  );
  setup.files.files.set(path, "{not-json");

  const recovery = await setup.repository.recoverStartup();

  assert.equal(setup.files.files.has(path), false);
  assert(
    [...setup.files.files.keys()].some((entry) =>
      entry.includes(
        "quarantine/artifact-artifact-broken-orphan.json.corrupt-",
      ),
    ),
  );
  assert(recovery.warnings.some((warning) => warning.includes("quarantined")));
});

test("a corrupt artifact is isolated and does not block another project", async () => {
  const setup = repository();
  await setup.repository.createProject({
    projectID: "project-good",
    name: "Good",
  });
  await setup.repository.createProject({
    projectID: "project-bad",
    name: "Bad",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  const bad = await setup.repository.createArtifact("project-bad", {
    artifactID: "artifact-corrupt",
    type: "review-log",
    title: "Review log",
    status: "complete",
    sourceIDs: [sourceA.sourceID],
    lineage: lineage([sourceA]),
    payload: {},
  });
  setup.files.files.set(
    setup.repository.getArtifactPath("project-bad", bad.artifact.artifactID),
    "{not-json",
  );

  const listed = await setup.repository.listArtifacts("project-bad");
  assert.equal(listed.artifacts.length, 0);
  assert.match(listed.warnings[0], /Invalid Research Workspace JSON/);
  assert.equal(
    (await setup.repository.getProject("project-good")).project.name,
    "Good",
  );
});

test("project export and deletion remain strictly project scoped", async () => {
  const setup = repository();
  const projectA = await setup.repository.createProject({
    projectID: "project-export-a",
    name: "Export A",
  });
  const projectB = await setup.repository.createProject({
    projectID: "project-export-b",
    name: "Export B",
  });
  const sourceA = source("A");
  const sourceB = source("B");
  await setup.repository.putSource(sourceA);
  await setup.repository.putSource(sourceB);
  await setup.repository.addMembers(
    "project-export-a",
    projectA.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  await setup.repository.addMembers(
    "project-export-b",
    projectB.membersRevision,
    [{ sourceID: sourceB.sourceID }],
  );

  const exported = await setup.repository.exportProject("project-export-a");
  assert.deepEqual(
    exported.sources.map((entry) => entry.sourceID),
    [sourceA.sourceID],
  );
  assert.equal(JSON.stringify(exported).includes(sourceB.sourceID), false);
  assert.equal(JSON.stringify(exported).includes("/profile/"), false);

  await setup.repository.deleteProject("project-export-a");
  assert.deepEqual(
    (await setup.repository.listProjects()).map((entry) => entry.projectID),
    ["project-export-b"],
  );
  assert.equal(
    Boolean(await setup.repository.getSource(sourceA.sourceID)),
    true,
  );
  assert.equal(
    (await setup.repository.getProject("project-export-b")).project.name,
    "Export B",
  );
});

test("cache pruning cannot delete durable projects or sources", async () => {
  const setup = repository();
  await setup.repository.createProject({
    projectID: "project-cache",
    name: "Cache safety",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  setup.files.files.set(
    `${setup.repository.cacheRoot}/extraction/cache.json`,
    "derived",
  );

  await setup.repository.pruneDerivedCache();
  assert.equal(
    setup.files.files.has(
      `${setup.repository.cacheRoot}/extraction/cache.json`,
    ),
    false,
  );
  assert.equal(
    (await setup.repository.getProject("project-cache")).project.name,
    "Cache safety",
  );
  assert.equal(
    Boolean(await setup.repository.getSource(sourceA.sourceID)),
    true,
  );
});

test("superseding an upstream artifact stales dependent derived artifacts", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-derived-staleness",
    name: "Derived staleness",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  const members = await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const upstream = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "claim-ledger",
      title: "Claims",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], "run-upstream-1"),
      payload: { claims: [{ text: "First" }] },
      completedAt: "2026-08-29T00:00:01.000Z",
    },
  );
  const dependent = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "contradiction-gap-dashboard",
      title: "Contradictions & Evidence Gaps",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-derived-1"),
        operation: "contradiction-gap-dashboard",
        providerMode: "local",
        membersRevision: members.revision,
        artifactInputs: [
          {
            artifactID: upstream.artifact.artifactID,
            artifactType: upstream.artifact.type,
            version: upstream.artifact.version,
            updatedAt: upstream.artifact.updatedAt,
            payloadFingerprint: "artifact-payload-12345678-10",
          },
        ],
      },
      payload: { kind: "research-workspace-contradiction-gap-dashboard" },
      completedAt: "2026-08-29T00:00:02.000Z",
    },
  );

  await setup.repository.createArtifact(project.project.projectID, {
    type: "claim-ledger",
    title: "Claims",
    status: "complete",
    sourceIDs: [sourceA.sourceID],
    lineage: lineage([sourceA], "run-upstream-2"),
    payload: { claims: [{ text: "Second" }] },
    completedAt: "2026-08-29T00:00:03.000Z",
  });

  const stored = await setup.repository.getArtifact(
    project.project.projectID,
    dependent.artifact.artifactID,
  );
  assert.equal(stored?.artifact.status, "stale");
  assert.deepEqual(stored?.artifact.staleReasons, [
    `upstream-artifact-changed:${upstream.artifact.artifactID}`,
  ]);
  const replay = await setup.repository.markArtifactsStaleForArtifact({
    projectID: project.project.projectID,
    artifactID: upstream.artifact.artifactID,
  });
  assert.deepEqual(replay, []);
});

test("artifact updates stale every transitive dependent without looping", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-transitive-staleness",
    name: "Transitive staleness",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const upstream = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "claim-ledger",
      title: "Claims",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], "run-transitive-a"),
      payload: { claims: [{ text: "Before" }] },
    },
  );
  const middle = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "contradiction-gap-dashboard",
      title: "Derived B",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-transitive-b"),
        artifactInputs: [
          {
            artifactID: upstream.artifact.artifactID,
            artifactType: upstream.artifact.type,
            version: upstream.artifact.version,
            updatedAt: upstream.artifact.updatedAt,
            payloadFingerprint: "artifact-payload-upstream",
          },
        ],
      },
      payload: { stage: "middle" },
    },
  );
  const leaf = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "review-log",
      title: "Derived C",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-transitive-c"),
        artifactInputs: [
          {
            artifactID: middle.artifact.artifactID,
            artifactType: middle.artifact.type,
            version: middle.artifact.version,
            updatedAt: middle.artifact.updatedAt,
            payloadFingerprint: "artifact-payload-middle",
          },
        ],
      },
      payload: { stage: "leaf" },
    },
  );
  const upstreamFile = await setup.repository.getArtifact(
    project.project.projectID,
    upstream.artifact.artifactID,
  );
  assert(upstreamFile);
  await setup.repository.updateArtifact(
    project.project.projectID,
    upstream.artifact.artifactID,
    upstreamFile.revision,
    (artifact) => ({ ...artifact, payload: { claims: [{ text: "After" }] } }),
  );

  const storedMiddle = await setup.repository.getArtifact(
    project.project.projectID,
    middle.artifact.artifactID,
  );
  const storedLeaf = await setup.repository.getArtifact(
    project.project.projectID,
    leaf.artifact.artifactID,
  );
  assert.equal(storedMiddle?.artifact.status, "stale");
  assert.equal(storedLeaf?.artifact.status, "stale");
  assert(
    storedLeaf?.artifact.staleReasons?.includes(
      `upstream-artifact-changed:${upstream.artifact.artifactID}`,
    ),
  );
});

test("deleting an upstream artifact leaves its dependents stale", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-deleted-input",
    name: "Deleted input",
  });
  const sourceA = source("A");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const upstream = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "claim-ledger",
      title: "Claims",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], "run-delete-a"),
      payload: { claims: [] },
    },
  );
  const dependent = await setup.repository.createArtifact(
    project.project.projectID,
    {
      type: "contradiction-gap-dashboard",
      title: "Dependent",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-delete-b"),
        artifactInputs: [
          {
            artifactID: upstream.artifact.artifactID,
            artifactType: upstream.artifact.type,
            version: upstream.artifact.version,
            updatedAt: upstream.artifact.updatedAt,
            payloadFingerprint: "artifact-payload-upstream",
          },
        ],
      },
      payload: {},
    },
  );

  await setup.repository.deleteArtifact(
    project.project.projectID,
    upstream.artifact.artifactID,
  );
  assert.equal(
    await setup.repository.getArtifact(
      project.project.projectID,
      upstream.artifact.artifactID,
    ),
    undefined,
  );
  const stored = await setup.repository.getArtifact(
    project.project.projectID,
    dependent.artifact.artifactID,
  );
  assert.equal(stored?.artifact.status, "stale");
  assert.deepEqual(stored?.artifact.staleReasons, [
    `upstream-artifact-deleted:${upstream.artifact.artifactID}`,
  ]);
});

test("source staleness survives a concurrent artifact revision and preserves its payload", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-source-stale-race",
    name: "Source stale race",
  });
  const sourceA = source("RACE-SOURCE");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const artifact = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-source-stale-race",
      type: "claim-ledger",
      title: "Concurrent source review",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], "run-source-stale-race"),
      payload: { review: { decision: "before" } },
    },
  );
  const concurrentPayload = {
    review: { decision: "accepted", note: "preserve me" },
    claims: ["concurrent payload"],
  };
  injectConcurrentArtifactRevision(
    setup,
    project.project.projectID,
    artifact.artifact.artifactID,
    concurrentPayload,
  );

  const changed = await setup.repository.markArtifactsStaleForSource({
    projectID: project.project.projectID,
    sourceID: sourceA.sourceID,
    contentFingerprint: "fingerprint-RACE-SOURCE-v2",
  });

  assert.deepEqual(changed, [artifact.artifact.artifactID]);
  const stored = await setup.repository.getArtifact(
    project.project.projectID,
    artifact.artifact.artifactID,
  );
  assert.equal(stored?.artifact.status, "stale");
  assert.deepEqual(stored?.artifact.payload, concurrentPayload);
  assert(
    stored?.artifact.staleReasons?.includes(
      `source-content-changed:${sourceA.sourceID}`,
    ),
  );
});

test("membership staleness survives a concurrent artifact revision", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-members-stale-race",
    name: "Members stale race",
  });
  const sourceA = source("RACE-MEMBERS");
  await setup.repository.putSource(sourceA);
  const members = await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const artifact = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-members-stale-race",
      type: "review-log",
      title: "Concurrent membership review",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-members-stale-race"),
        membersRevision: members.revision,
      },
      payload: { reviewEvents: [] },
    },
  );
  const concurrentPayload = {
    reviewEvents: [{ action: "confirmed", submissionID: "submission-race" }],
  };
  injectConcurrentArtifactRevision(
    setup,
    project.project.projectID,
    artifact.artifact.artifactID,
    concurrentPayload,
  );

  const changed = await setup.repository.markArtifactsStaleForMembersRevision({
    projectID: project.project.projectID,
    membersRevision: members.revision + 1,
  });

  assert.deepEqual(changed, [artifact.artifact.artifactID]);
  const stored = await setup.repository.getArtifact(
    project.project.projectID,
    artifact.artifact.artifactID,
  );
  assert.equal(stored?.artifact.status, "stale");
  assert.deepEqual(stored?.artifact.payload, concurrentPayload);
  assert(
    stored?.artifact.staleReasons?.includes("project-source-scope-changed"),
  );
});

test("upstream propagation survives a concurrent dependent revision", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-upstream-stale-race",
    name: "Upstream stale race",
  });
  const sourceA = source("RACE-UPSTREAM");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const upstream = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-race-upstream",
      type: "claim-ledger",
      title: "Race upstream",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], "run-race-upstream"),
      payload: { claims: [] },
    },
  );
  const dependent = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-race-dependent",
      type: "contradiction-gap-dashboard",
      title: "Race dependent",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: {
        ...lineage([sourceA], "run-race-dependent"),
        artifactInputs: [
          {
            artifactID: upstream.artifact.artifactID,
            artifactType: upstream.artifact.type,
            version: upstream.artifact.version,
            updatedAt: upstream.artifact.updatedAt,
            payloadFingerprint: "artifact-payload-race-upstream",
          },
        ],
      },
      payload: { review: "before" },
    },
  );
  const concurrentPayload = {
    review: "confirmed concurrently",
    notes: ["must survive stale propagation"],
  };
  injectConcurrentArtifactRevision(
    setup,
    project.project.projectID,
    dependent.artifact.artifactID,
    concurrentPayload,
  );

  const changed = await setup.repository.markArtifactsStaleForArtifact({
    projectID: project.project.projectID,
    artifactID: upstream.artifact.artifactID,
  });

  assert.deepEqual(changed, [dependent.artifact.artifactID]);
  const stored = await setup.repository.getArtifact(
    project.project.projectID,
    dependent.artifact.artifactID,
  );
  assert.equal(stored?.artifact.status, "stale");
  assert.deepEqual(stored?.artifact.payload, concurrentPayload);
  assert(
    stored?.artifact.staleReasons?.includes(
      `upstream-artifact-changed:${upstream.artifact.artifactID}`,
    ),
  );
});

test("stale propagation discovers a dependent created after its initial snapshot", async () => {
  const setup = repository();
  const project = await setup.repository.createProject({
    projectID: "project-dynamic-stale-traversal",
    name: "Dynamic stale traversal",
  });
  const sourceA = source("DYNAMIC-TRAVERSAL");
  await setup.repository.putSource(sourceA);
  await setup.repository.addMembers(
    project.project.projectID,
    project.membersRevision,
    [{ sourceID: sourceA.sourceID }],
  );
  const upstream = await setup.repository.createArtifact(
    project.project.projectID,
    {
      artifactID: "artifact-dynamic-upstream",
      type: "claim-ledger",
      title: "Dynamic upstream",
      status: "complete",
      sourceIDs: [sourceA.sourceID],
      lineage: lineage([sourceA], "run-dynamic-upstream"),
      payload: { claims: [] },
    },
  );

  const originalList = setup.repository.listArtifacts.bind(setup.repository);
  const originalCreate = setup.repository.createArtifact.bind(setup.repository);
  let injected = false;
  let dependentArtifactID: string | undefined;
  const patchedList = (async (projectID: string) => {
    const listed = await originalList(projectID);
    if (!injected && projectID === project.project.projectID) {
      injected = true;
      setup.repository.listArtifacts =
        originalList as typeof setup.repository.listArtifacts;
      const dependent = await originalCreate(projectID, {
        artifactID: "artifact-dynamic-dependent",
        type: "contradiction-gap-dashboard",
        title: "Dynamic dependent",
        status: "complete",
        sourceIDs: [sourceA.sourceID],
        lineage: {
          ...lineage([sourceA], "run-dynamic-dependent"),
          artifactInputs: [
            {
              artifactID: upstream.artifact.artifactID,
              artifactType: upstream.artifact.type,
              version: upstream.artifact.version,
              updatedAt: upstream.artifact.updatedAt,
              payloadFingerprint: "artifact-payload-dynamic-upstream",
            },
          ],
        },
        payload: { createdDuringPropagation: true },
      });
      dependentArtifactID = dependent.artifact.artifactID;
      setup.repository.listArtifacts = patchedList;
    }
    return listed;
  }) as typeof setup.repository.listArtifacts;
  setup.repository.listArtifacts = patchedList;

  const changed = await setup.repository.markArtifactsStaleForArtifact({
    projectID: project.project.projectID,
    artifactID: upstream.artifact.artifactID,
  });

  assert(dependentArtifactID);
  assert.deepEqual(changed, [dependentArtifactID]);
  assert.equal(
    (
      await setup.repository.getArtifact(
        project.project.projectID,
        dependentArtifactID,
      )
    )?.artifact.status,
    "stale",
  );
});
