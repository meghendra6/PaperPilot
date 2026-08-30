import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
  ResearchWorkspaceRevisionConflictError,
  type ResearchWorkspaceChangeInboxFile,
  type ResearchWorkspaceFileOps,
} from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import { parseResearchWorkspaceChangeInboxFile } from "../src/modules/researchWorkspace/persistence/validation";

class MemoryWorkspaceFiles implements ResearchWorkspaceFileOps {
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
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) this.files.delete(key);
    }
    for (const key of [...this.directories]) {
      if (key === path || key.startsWith(prefix)) {
        this.directories.delete(key);
      }
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function setupRepository() {
  const files = new MemoryWorkspaceFiles();
  let clock = Date.parse("2026-08-29T00:00:00.000Z");
  return {
    files,
    repository: new ResearchWorkspaceProjectRepository({
      rootDir: "/profile/paperpilot-research-workspace",
      fileOps: files,
      now: () => new Date(clock++),
    }),
  };
}

function validInbox(): ResearchWorkspaceChangeInboxFile {
  return {
    schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
    revision: 3,
    projectID: "project-living",
    initializedAt: "2026-08-29T00:00:00.000Z",
    lastCheckedAt: "2026-08-29T01:00:00.000Z",
    snapshots: [
      {
        sourceID: "zotero:1:ITEM-A:PDF-A",
        availability: "ready",
        contentFingerprint: "pdf-a-v2",
        annotationFingerprint: "annotations-empty",
        observedAt: "2026-08-29T01:00:00.000Z",
        annotation: {
          algorithm: "zotero-annotation-keys-version-date-v1",
          value: "annotations-empty",
          count: 0,
        },
      },
    ],
    changes: [
      {
        changeID: "living-change-1",
        dedupeKey: "zotero:1:ITEM-A:PDF-A|pdf-content-changed|v1|v2",
        sourceID: "zotero:1:ITEM-A:PDF-A",
        kind: "pdf-content-changed",
        before: {
          availability: "ready",
          contentFingerprint: "pdf-a-v1",
          annotationFingerprint: "annotations-empty",
        },
        after: {
          availability: "ready",
          contentFingerprint: "pdf-a-v2",
          annotationFingerprint: "annotations-empty",
        },
        detectedAt: "2026-08-29T01:00:00.000Z",
        resolution: {
          action: "reviewed",
          submissionID: "living-resolution-1",
          actedAt: "2026-08-29T01:10:00.000Z",
        },
      },
    ],
  };
}

test("change inbox path, lazy creation, and project isolation", async () => {
  const setup = setupRepository();
  await setup.repository.createProject({
    projectID: "project-living-a",
    name: "Living A",
  });
  await setup.repository.createProject({
    projectID: "project-living-b",
    name: "Living B",
  });

  const pathA = setup.repository.getChangeInboxPath("project-living-a");
  const pathB = setup.repository.getChangeInboxPath("project-living-b");
  assert.equal(
    pathA,
    "/profile/paperpilot-research-workspace/projects/project-project-living-a/change-inbox.json",
  );
  assert.equal(setup.files.files.has(pathA), false);
  assert.deepEqual(await setup.repository.getChangeInbox("project-living-a"), {
    schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
    revision: 0,
    projectID: "project-living-a",
    snapshots: [],
    changes: [],
  });
  assert.equal(setup.files.files.has(pathA), false);

  const created = await setup.repository.updateChangeInbox(
    "project-living-a",
    0,
    (inbox) => ({
      ...inbox,
      initializedAt: "2026-08-29T01:00:00.000Z",
    }),
  );
  assert.equal(created.revision, 1);
  assert.equal(setup.files.files.has(pathA), true);
  assert.equal(setup.files.files.has(pathB), false);
  assert.equal(
    (await setup.repository.getChangeInbox("project-living-b")).revision,
    0,
  );
});

test("change inbox updates are revision guarded", async () => {
  const setup = setupRepository();
  await setup.repository.createProject({
    projectID: "project-living-cas",
    name: "Living CAS",
  });
  const first = await setup.repository.updateChangeInbox(
    "project-living-cas",
    0,
    (inbox) => ({
      ...inbox,
      lastCheckedAt: "2026-08-29T01:00:00.000Z",
    }),
  );
  assert.equal(first.revision, 1);

  await assert.rejects(
    () =>
      setup.repository.updateChangeInbox(
        "project-living-cas",
        0,
        (inbox) => inbox,
      ),
    ResearchWorkspaceRevisionConflictError,
  );
  const stored = await setup.repository.getChangeInbox("project-living-cas");
  assert.equal(stored.revision, 1);
  assert.equal(stored.lastCheckedAt, "2026-08-29T01:00:00.000Z");
});

test("change inbox parser validates bounded provenance and identities", () => {
  const valid = validInbox();
  assert.deepEqual(
    parseResearchWorkspaceChangeInboxFile(
      JSON.parse(JSON.stringify(valid)) as unknown,
    ),
    valid,
  );

  const rejects = (
    mutate: (candidate: ResearchWorkspaceChangeInboxFile) => void,
    pattern: RegExp,
  ) => {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(
      () => parseResearchWorkspaceChangeInboxFile(candidate),
      pattern,
    );
  };

  rejects((value) => {
    value.projectID = "../foreign";
  }, /projectID contains unsupported path characters/);
  rejects((value) => {
    value.snapshots[0].sourceID = "not-a-stable-source";
  }, /supported Research Workspace sourceID/);
  rejects((value) => {
    value.changes[0].changeID = "../change";
  }, /changeID contains unsupported path characters/);
  rejects((value) => {
    value.snapshots.push(structuredClone(value.snapshots[0]));
  }, /Duplicate change inbox snapshot/);
  rejects((value) => {
    value.changes.push({
      ...structuredClone(value.changes[0]),
      changeID: "living-change-2",
    });
  }, /Duplicate change inbox dedupeKey/);
  rejects((value) => {
    value.snapshots[0].annotation!.count = -1;
  }, /annotation count must be a non-negative integer/);
  rejects((value) => {
    value.snapshots[0].annotation!.value = "different-hash";
  }, /does not match annotationFingerprint/);
  rejects((value) => {
    delete value.snapshots[0].annotation;
  }, /must both be present/);
  rejects((value) => {
    value.changes[0].before.availability = "gone" as "ready";
  }, /availability is unsupported/);
  rejects((value) => {
    value.changes[0].kind = "new-paper" as "pdf-content-changed";
  }, /kind is unsupported/);
  rejects((value) => {
    value.changes[0].resolution!.action = "ignored" as "reviewed";
  }, /resolution action is unsupported/);
  rejects((value) => {
    value.snapshots = Array.from({ length: 10_001 }, () =>
      structuredClone(valid.snapshots[0]),
    );
  }, /at most 10000/);
});

test("a failed change inbox mutation preserves the prior file atomically", async () => {
  const setup = setupRepository();
  await setup.repository.createProject({
    projectID: "project-living-atomic",
    name: "Living Atomic",
  });
  await setup.repository.updateChangeInbox(
    "project-living-atomic",
    0,
    (inbox) => ({
      ...inbox,
      initializedAt: "2026-08-29T01:00:00.000Z",
    }),
  );
  const path = setup.repository.getChangeInboxPath("project-living-atomic");
  const before = setup.files.files.get(path);

  await assert.rejects(
    () =>
      setup.repository.updateChangeInbox(
        "project-living-atomic",
        undefined,
        (inbox) => ({
          ...inbox,
          snapshots: [
            {
              sourceID: "invalid-source",
              availability: "ready",
              observedAt: "2026-08-29T02:00:00.000Z",
            },
          ],
        }),
      ),
    /supported Research Workspace sourceID/,
  );
  assert.equal(setup.files.files.get(path), before);
  assert.equal(
    (await setup.repository.getChangeInbox("project-living-atomic")).revision,
    1,
  );
});
