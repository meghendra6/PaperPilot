import { test } from "node:test";
import * as assert from "node:assert/strict";

import { ResearchWorkspaceLivingReviewService } from "../src/modules/researchWorkspace/livingReviewService";
import { ResearchWorkspaceOperationCoordinator } from "../src/modules/researchWorkspace/operationCoordinator";
import type { ResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";
import type {
  ResearchWorkspaceFileOps,
  ResearchWorkspaceLivingReviewSnapshot,
} from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import {
  ResearchWorkspaceProjectController,
  quickProjectID,
  researchWorkspaceSourceRecordFromPaper,
} from "../src/modules/researchWorkspace/projectController";
import {
  quiesceResearchWorkspaceProject,
  releaseResearchWorkspaceProjectDeletion,
} from "../src/modules/researchWorkspace/projectRunAdmission";

class MemoryFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly writes: Array<{ path: string; contents: string }> = [];

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
    this.writes.push({ path, contents });
    this.files.set(path, contents);
  }
  async remove(path: string, options?: { recursive?: boolean }) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const entry of [...this.files.keys()]) {
      if (entry === path || (options?.recursive && entry.startsWith(prefix))) {
        this.files.delete(entry);
      }
    }
  }
  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function paper(suffix: string): ResearchWorkspacePaper {
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
      value: `pdf-${suffix}-v1`,
    },
    title: `Paper ${suffix}`,
    context: `Paper ${suffix} context`,
    extractionQuality: "structured",
  };
}

function setup() {
  let tick = Date.parse("2026-08-29T10:00:00.000Z");
  let id = 0;
  const files = new MemoryFiles();
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir: "/profile/paperpilot-research-workspace",
    fileOps: files,
    now: () => new Date(tick++),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  const projects = new ResearchWorkspaceProjectController(repository, {
    now: () => new Date(tick++),
  });
  const operations = new ResearchWorkspaceOperationCoordinator(repository, {
    now: () => new Date(tick++),
  });
  const observed = new Map<string, ResearchWorkspaceLivingReviewSnapshot>();
  let serviceTime = Date.parse("2026-08-29T12:00:00.000Z");
  const service = new ResearchWorkspaceLivingReviewService(repository, {
    now: () => new Date(serviceTime++),
    observer: async (source, observedAt) =>
      structuredClone(
        observed.get(source.sourceID) ?? {
          sourceID: source.sourceID,
          observedAt,
          availability: source.availability,
          contentFingerprint: source.contentFingerprint?.value,
          annotationFingerprint: "annotations-v1",
          annotation: {
            algorithm: "zotero-annotation-keys-version-date-v1",
            value: "annotations-v1",
            count: 0,
          },
        },
      ),
  });
  return { files, repository, projects, operations, observed, service };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("project deletion waits for the coordinator's final run persistence", async (t) => {
  const { files, repository, projects, operations } = setup();
  const source = paper("Z");
  const projectID = "project-deletion-final-run";
  await projects.createProject({ projectID, name: "Deletion" }, [source]);
  const saving = deferred();
  const finishSave = deferred();
  const write = files.writeTextAtomic.bind(files);
  t.mock.method(
    files,
    "writeTextAtomic",
    async (path: string, contents: string) => {
      if (JSON.parse(contents).run?.status === "completed") {
        saving.resolve();
        await finishSave.promise;
      }
      await write(path, contents);
    },
  );
  const params = {
    projectID,
    papers: [source],
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "claims-v1",
    artifactType: "claim-ledger" as const,
    artifactTitle: "Claims",
    providerMode: "local" as const,
    execute: async () => ({ claims: [] }),
  };
  const run = operations.run(params);
  await saving.promise;
  let drained = false;
  const projectRoot = repository.getProjectRoot(projectID);
  const deletion = quiesceResearchWorkspaceProject(projectRoot).then(() => {
    drained = true;
  });
  await assert.rejects(
    new ResearchWorkspaceOperationCoordinator(repository).run(params),
    /being deleted/,
  );
  assert.equal(drained, false);
  finishSave.resolve();
  const [completed] = await Promise.all([run, deletion]);
  assert.equal(completed.run.run.status, "completed");
  assert.equal(drained, true);
  releaseResearchWorkspaceProjectDeletion(projectRoot);
});

test("quick-project deletion blocks implicit creation before preparation", async () => {
  const { files, repository, operations } = setup();
  const source = paper("Q");
  const projectRoot = repository.getProjectRoot(quickProjectID([source]));
  await quiesceResearchWorkspaceProject(projectRoot);
  const before = files.writes.length;
  await assert.rejects(
    operations.run({
      papers: [source],
      operation: "claims",
      operationVersion: "claims-v1",
      artifactType: "claim-ledger",
      artifactTitle: "Claims",
      providerMode: "local",
      execute: async () => ({ claims: [] }),
    }),
    /being deleted/,
  );
  assert.equal(files.writes.length, before);
  releaseResearchWorkspaceProjectDeletion(projectRoot);
});

test("deletion drains an admitted Living Review scan through inbox persistence", async () => {
  const { repository, projects } = setup();
  const projectID = "project-deletion-scan";
  await projects.createProject({ projectID, name: "Scan" }, [paper("S")]);
  const observing = deferred();
  const finish = deferred();
  const service = new ResearchWorkspaceLivingReviewService(repository, {
    observer: async (source, observedAt) => {
      observing.resolve();
      await finish.promise;
      return {
        sourceID: source.sourceID,
        observedAt,
        availability: "ready",
        contentFingerprint: source.contentFingerprint?.value,
      };
    },
  });
  const scan = service.checkProject(projectID);
  await observing.promise;
  const projectRoot = repository.getProjectRoot(projectID);
  let drained = false;
  const deletion = quiesceResearchWorkspaceProject(projectRoot).then(() => {
    drained = true;
  });
  await assert.rejects(
    service.resolveChange({
      projectID,
      changeID: "change",
      action: "reviewed",
      submissionID: "submission",
      expectedRevision: 0,
    }),
    /being deleted/,
  );
  await assert.rejects(
    new ResearchWorkspaceLivingReviewService(repository).checkProject(
      projectID,
    ),
    /being deleted/,
  );
  assert.equal(drained, false);
  finish.resolve();
  const [inbox] = await Promise.all([scan, deletion]);
  assert.equal(
    (await repository.getChangeInbox(projectID)).revision,
    inbox.revision,
  );
  assert.ok(inbox.lastCheckedAt);
  releaseResearchWorkspaceProjectDeletion(projectRoot);
});

test("a different project's Living Review cannot invalidate a deleting shared-source project", async (t) => {
  const { repository, projects, observed, service } = setup();
  const source = paper("X");
  const activeID = "project-deletion-sharing-active";
  const deletingID = "project-deletion-sharing-target";
  await projects.createProject({ projectID: activeID, name: "Active" }, [
    source,
  ]);
  await projects.createProject({ projectID: deletingID, name: "Deleting" }, [
    source,
  ]);
  observed.set(source.sourceID, {
    sourceID: source.sourceID,
    observedAt: "2026-10-24T00:00:00.000Z",
    availability: "ready",
    contentFingerprint: "pdf-X-v2",
  });
  const invalidated: string[] = [];
  const invalidate = repository.markArtifactsStaleForSource.bind(repository);
  t.mock.method(
    repository,
    "markArtifactsStaleForSource",
    (params: Parameters<typeof invalidate>[0]) => {
      invalidated.push(params.projectID);
      return invalidate(params);
    },
  );
  const projectRoot = repository.getProjectRoot(deletingID);
  await quiesceResearchWorkspaceProject(projectRoot);
  await service.checkProject(activeID);
  assert.deepEqual(invalidated, [activeID]);
  releaseResearchWorkspaceProjectDeletion(projectRoot);
});

test("deletion drains a shared-source invalidation already admitted by another project", async (t) => {
  const { repository, projects, observed, service } = setup();
  const source = paper("W");
  const activeID = "project-deletion-shared-running";
  const deletingID = "project-deletion-shared-saving";
  await projects.createProject({ projectID: activeID, name: "Active" }, [
    source,
  ]);
  await projects.createProject({ projectID: deletingID, name: "Deleting" }, [
    source,
  ]);
  observed.set(source.sourceID, {
    sourceID: source.sourceID,
    observedAt: "2026-10-24T00:00:00.000Z",
    availability: "ready",
    contentFingerprint: "pdf-W-v2",
  });
  const saving = deferred();
  const finish = deferred();
  const invalidate = repository.markArtifactsStaleForSource.bind(repository);
  t.mock.method(
    repository,
    "markArtifactsStaleForSource",
    async (params: Parameters<typeof invalidate>[0]) => {
      if (params.projectID === deletingID) {
        saving.resolve();
        await finish.promise;
      }
      return invalidate(params);
    },
  );
  const scan = service.checkProject(activeID);
  await saving.promise;
  const projectRoot = repository.getProjectRoot(deletingID);
  let drained = false;
  const deletion = quiesceResearchWorkspaceProject(projectRoot).then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  finish.resolve();
  await Promise.all([scan, deletion]);
  assert.equal(drained, true);
  releaseResearchWorkspaceProjectDeletion(projectRoot);
});

test("Living Review baselines silently, ignores annotation-only staleness, and invalidates a changed PDF", async () => {
  const setupState = setup();
  const sourcePaper = paper("A");
  const created = await setupState.projects.createProject(
    { projectID: "project-living-service", name: "Living service" },
    [sourcePaper],
  );
  const artifact = await setupState.operations.run({
    projectID: created.project.projectID,
    papers: [sourcePaper],
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "claims-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [] }),
  });
  let invalidationCalls = 0;
  const originalInvalidate =
    setupState.repository.markArtifactsStaleForSource.bind(
      setupState.repository,
    );
  setupState.repository.markArtifactsStaleForSource = async (...args) => {
    invalidationCalls += 1;
    return originalInvalidate(...args);
  };

  const baseline = await setupState.service.checkProject(
    created.project.projectID,
  );
  assert.equal(baseline.changes.length, 0);
  assert.equal(invalidationCalls, 0);
  setupState.observed.set(sourcePaper.sourceID, {
    sourceID: sourcePaper.sourceID,
    observedAt: "2026-08-29T12:01:00.000Z",
    availability: "ready",
    contentFingerprint: "pdf-A-v1",
    annotationFingerprint: "annotations-v2",
    annotation: {
      algorithm: "zotero-annotation-keys-version-date-v1",
      value: "annotations-v2",
      count: 1,
    },
  });
  const annotations = await setupState.service.checkProject(
    created.project.projectID,
  );
  assert.equal(annotations.changes.at(-1)?.kind, "annotations-changed");
  assert.equal(
    (
      await setupState.repository.getArtifact(
        created.project.projectID,
        artifact.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "complete",
  );

  setupState.observed.set(sourcePaper.sourceID, {
    ...setupState.observed.get(sourcePaper.sourceID)!,
    observedAt: "2026-08-29T12:02:00.000Z",
    contentFingerprint: "pdf-A-v2",
  });
  const changed = await setupState.service.checkProject(
    created.project.projectID,
  );
  assert.equal(changed.changes.at(-1)?.kind, "pdf-content-changed");
  assert.ok(invalidationCalls > 0);
  const source = await setupState.repository.getSource(sourcePaper.sourceID);
  assert.equal(source?.source.contentFingerprint?.value, "pdf-A-v2");
  assert.equal(source?.source.extractionQuality, "unavailable");
  assert.equal(source?.source.extractionFingerprint, undefined);
  assert.equal(source?.source.lastExtractedAt, undefined);
  assert.equal(
    (
      await setupState.repository.getArtifact(
        created.project.projectID,
        artifact.artifact.artifact.artifactID,
      )
    )?.artifact.status,
    "stale",
  );
});

test("Mark reviewed and Dismiss still apply after a background scan bumps the inbox revision", async () => {
  const setupState = setup();
  const sourcePaper = paper("A");
  const created = await setupState.projects.createProject(
    { projectID: "project-living-resolve", name: "Living resolve" },
    [sourcePaper],
  );
  await setupState.service.checkProject(created.project.projectID);
  setupState.observed.set(sourcePaper.sourceID, {
    sourceID: sourcePaper.sourceID,
    observedAt: "2026-08-29T12:01:00.000Z",
    availability: "ready",
    contentFingerprint: "pdf-A-v1",
    annotationFingerprint: "annotations-v2",
    annotation: {
      algorithm: "zotero-annotation-keys-version-date-v1",
      value: "annotations-v2",
      count: 1,
    },
  });
  const displayed = await setupState.service.checkProject(
    created.project.projectID,
  );
  const change = displayed.changes.at(-1);
  assert.ok(change);
  // A Zotero item event triggers another scan after the panel rendered.
  const background = await setupState.service.checkProject(
    created.project.projectID,
  );
  assert.ok(background.revision > displayed.revision);

  const resolved = await setupState.service.resolveChange({
    projectID: created.project.projectID,
    changeID: change.changeID,
    action: "dismissed",
    submissionID: "submission-dismiss-1",
    expectedRevision: displayed.revision,
  });
  assert.equal(
    resolved.changes.find((entry) => entry.changeID === change.changeID)
      ?.resolution?.action,
    "dismissed",
  );
});

test("source unavailable and restored transitions preserve same-PDF extraction lineage", async () => {
  const setupState = setup();
  const sourcePaper = paper("B");
  const created = await setupState.projects.createProject(
    { projectID: "project-living-restore", name: "Living restore" },
    [sourcePaper],
  );
  await setupState.service.checkProject(created.project.projectID);
  setupState.observed.set(sourcePaper.sourceID, {
    sourceID: sourcePaper.sourceID,
    observedAt: "2026-08-29T12:03:00.000Z",
    availability: "missing-file",
  });
  await setupState.service.checkProject(created.project.projectID);
  setupState.observed.set(sourcePaper.sourceID, {
    sourceID: sourcePaper.sourceID,
    observedAt: "2026-08-29T12:04:00.000Z",
    availability: "ready",
    contentFingerprint: "pdf-B-v1",
  });
  const restored = await setupState.service.checkProject(
    created.project.projectID,
  );
  assert.equal(restored.changes.at(-1)?.kind, "source-restored");
  const source = await setupState.repository.getSource(sourcePaper.sourceID);
  assert.equal(source?.source.availability, "ready");
  assert.equal(source?.source.extractionQuality, "structured");
  assert(source?.source.extractionFingerprint);
});

test("inbox CAS conflicts are retried against the latest persisted baseline", async () => {
  const setupState = setup();
  const created = await setupState.projects.createProject(
    { projectID: "project-living-cas", name: "Living CAS" },
    [paper("C")],
  );
  const originalUpdate = setupState.repository.updateChangeInbox.bind(
    setupState.repository,
  );
  let inject = true;
  setupState.repository.updateChangeInbox = (async (
    projectID,
    expectedRevision,
    mutate,
  ) => {
    if (inject) {
      inject = false;
      await originalUpdate(projectID, expectedRevision, (inbox) => ({
        ...inbox,
        initializedAt: "2026-08-29T11:59:00.000Z",
      }));
    }
    return originalUpdate(projectID, expectedRevision, mutate);
  }) as typeof setupState.repository.updateChangeInbox;

  const inbox = await setupState.service.checkProject(
    created.project.projectID,
  );
  assert.equal(inbox.revision, 2);
  assert.equal(inbox.snapshots.length, 1);
  assert.equal(inbox.changes.length, 1);
  assert.equal(inbox.changes[0].kind, "project-source-added");
});

test("manual and notifier checks share one scan queue and cannot replay stale observations", async () => {
  const setupState = setup();
  const sourcePaper = paper("G");
  const created = await setupState.projects.createProject(
    { projectID: "project-living-serialized", name: "Serialized scans" },
    [sourcePaper],
  );
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  let now = Date.parse("2026-08-29T13:00:00.000Z");
  const serialized = new ResearchWorkspaceLivingReviewService(
    setupState.repository,
    {
      now: () => new Date(now++),
      observer: async (source, observedAt) => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const call = calls;
        if (call === 1) {
          firstStarted();
          await firstGate;
        }
        active -= 1;
        return {
          sourceID: source.sourceID,
          observedAt,
          availability: "ready",
          contentFingerprint: call === 1 ? "pdf-G-v1" : "pdf-G-v2",
        };
      },
    },
  );

  const first = serialized.checkProject(created.project.projectID);
  await started;
  const second = serialized.checkProject(created.project.projectID);
  await Promise.resolve();
  assert.equal(calls, 1);
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(maximumActive, 1);
  const inbox = await serialized.load(created.project.projectID);
  assert.equal(inbox.snapshots[0].contentFingerprint, "pdf-G-v2");
  assert.equal(inbox.changes.at(-1)?.kind, "pdf-content-changed");
});

test("background checks isolate one project failure and skip archived projects", async () => {
  const setupState = setup();
  await setupState.projects.createProject(
    { projectID: "project-living-good", name: "Good" },
    [paper("D")],
  );
  const archived = await setupState.projects.createProject(
    { projectID: "project-living-archived", name: "Archived" },
    [paper("E")],
  );
  await setupState.projects.archiveProject(archived.project.projectID);
  const originalCheck = setupState.service.checkProject.bind(
    setupState.service,
  );
  setupState.service.checkProject = (async (projectID) => {
    if (projectID === "project-living-bad") throw new Error("broken project");
    return originalCheck(projectID);
  }) as typeof setupState.service.checkProject;
  await setupState.projects.createProject(
    { projectID: "project-living-bad", name: "Bad" },
    [paper("F")],
  );

  const result = await setupState.service.checkAllActiveProjects();
  assert.deepEqual(result.checkedProjectIDs, ["project-living-good"]);
  assert.deepEqual(result.failures, [
    { projectID: "project-living-bad", message: "broken project" },
  ]);
  assert.equal(
    (await setupState.repository.getChangeInbox("project-living-archived"))
      .revision,
    0,
  );
});

test("a stale observation cannot overwrite a newer project-controller source update", async () => {
  const setupState = setup();
  const sourceX = paper("H");
  const created = await setupState.projects.createProject(
    { projectID: "project-living-observation-race", name: "Observation race" },
    [sourceX],
  );
  await setupState.service.checkProject(created.project.projectID);

  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let signalFirst: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => {
    signalFirst = resolve;
  });
  let calls = 0;
  const racingService = new ResearchWorkspaceLivingReviewService(
    setupState.repository,
    {
      now: () => new Date("2026-08-29T13:00:00.000Z"),
      observer: async (source, observedAt) => {
        calls += 1;
        if (calls === 1) {
          assert.equal(source.contentFingerprint?.value, "pdf-H-v1");
          signalFirst();
          await firstGate;
          return {
            sourceID: source.sourceID,
            observedAt,
            availability: "ready",
            contentFingerprint: "pdf-H-v1",
            annotationFingerprint: "annotations-v1",
            annotation: {
              algorithm: "zotero-annotation-keys-version-date-v1",
              value: "annotations-v1",
              count: 0,
            },
          };
        }
        assert.equal(source.contentFingerprint?.value, "pdf-H-v2");
        return {
          sourceID: source.sourceID,
          observedAt,
          availability: "ready",
          contentFingerprint: source.contentFingerprint?.value,
          annotationFingerprint: "annotations-v1",
          annotation: {
            algorithm: "zotero-annotation-keys-version-date-v1",
            value: "annotations-v1",
            count: 0,
          },
        };
      },
    },
  );

  const scan = racingService.checkProject(created.project.projectID);
  await firstStarted;
  const sourceY: ResearchWorkspacePaper = {
    ...sourceX,
    contentFingerprint: {
      ...sourceX.contentFingerprint,
      value: "pdf-H-v2",
    },
    context: "Paper H context from the newer source revision",
  };
  await setupState.projects.addPapers(created.project.projectID, [sourceY]);
  const sourcePath = setupState.repository.getSourcePath(sourceX.sourceID);
  const writesAfterY = setupState.files.writes.length;
  releaseFirst();
  const inbox = await scan;

  assert.equal(calls, 2);
  assert.equal(
    (await setupState.repository.getSource(sourceX.sourceID))?.source
      .contentFingerprint?.value,
    "pdf-H-v2",
  );
  assert.equal(inbox.snapshots[0]?.contentFingerprint, "pdf-H-v2");
  assert.deepEqual(
    inbox.changes.map((change) => ({
      kind: change.kind,
      before: change.before.contentFingerprint,
      after: change.after.contentFingerprint,
    })),
    [
      {
        kind: "pdf-content-changed",
        before: "pdf-H-v1",
        after: "pdf-H-v2",
      },
    ],
  );
  assert.equal(
    setupState.files.writes
      .slice(writesAfterY)
      .filter((write) => write.path === sourcePath)
      .some((write) => write.contents.includes('"value": "pdf-H-v1"')),
    false,
  );
});

test("a missing observation is discarded when the source is concurrently created", async () => {
  const setupState = setup();
  const sourceX = paper("I");
  const created = await setupState.projects.createProject(
    {
      projectID: "project-living-missing-create-race",
      name: "Missing create race",
    },
    [sourceX],
  );
  const sourcePath = setupState.repository.getSourcePath(sourceX.sourceID);
  setupState.files.files.delete(sourcePath);

  const sourceY: ResearchWorkspacePaper = {
    ...sourceX,
    contentFingerprint: {
      ...sourceX.contentFingerprint,
      value: "pdf-I-v2",
    },
    context: "Source created while the missing observation was in flight",
  };
  const originalGetSource = setupState.repository.getSource.bind(
    setupState.repository,
  );
  let sourceReads = 0;
  setupState.repository.getSource = (async (sourceID: string) => {
    if (sourceID === sourceX.sourceID) {
      sourceReads += 1;
      if (sourceReads === 2) {
        await setupState.repository.putSource(
          researchWorkspaceSourceRecordFromPaper(
            sourceY,
            new Date("2026-08-29T14:00:00.000Z"),
          ),
        );
      }
    }
    return originalGetSource(sourceID);
  }) as typeof setupState.repository.getSource;

  const service = new ResearchWorkspaceLivingReviewService(
    setupState.repository,
    {
      now: () => new Date("2026-08-29T14:01:00.000Z"),
      observer: async (source, observedAt) => ({
        sourceID: source.sourceID,
        observedAt,
        availability: "ready",
        contentFingerprint: source.contentFingerprint?.value,
      }),
    },
  );
  const inbox = await service.checkProject(created.project.projectID);

  assert(sourceReads >= 3);
  assert.equal(inbox.snapshots[0]?.availability, "ready");
  assert.equal(inbox.snapshots[0]?.contentFingerprint, "pdf-I-v2");
  assert.equal(inbox.changes.length, 0);
  assert.equal(
    (await originalGetSource(sourceX.sourceID))?.source.contentFingerprint
      ?.value,
    "pdf-I-v2",
  );
});
