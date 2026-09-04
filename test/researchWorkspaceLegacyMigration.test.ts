import { test } from "node:test";
import * as assert from "node:assert/strict";

import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";
import {
  LegacyResearchWorkspaceImporter,
  resolveLegacyZoteroSource,
  type LegacySourceResolutionCandidate,
} from "../src/modules/researchWorkspace/persistence/legacyMigration";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import { readResearchWorkspaceArtifact } from "../src/modules/researchWorkspace/legacyCapabilityAdapters";

class MemoryMigrationFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly writes: string[] = [];
  failOnce: ((path: string) => boolean) | undefined;

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
    if (this.failOnce?.(path)) {
      this.failOnce = undefined;
      throw new Error(`Injected migration failure: ${path}`);
    }
    this.writes.push(path);
    this.files.set(path, contents);
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    for (const key of [...this.files.keys()]) {
      if (key === path || (options?.recursive && key.startsWith(prefix))) {
        this.files.delete(key);
      }
    }
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function resolved(
  suffix: string,
  libraryID = 1,
): LegacySourceResolutionCandidate {
  return {
    sourceID: `zotero:${libraryID}:ITEM-${suffix}:PDF-${suffix}`,
    identity: {
      libraryID,
      itemKey: `ITEM-${suffix}`,
      attachmentKey: `PDF-${suffix}`,
      standaloneAttachment: false,
    },
    title: `Resolved ${suffix}`,
    runtimeItemID: 100 + suffix.charCodeAt(0),
    runtimeAttachmentID: 200 + suffix.charCodeAt(0),
    creators: [`Author ${suffix}`],
    year: 2025,
    doi: `10.1000/${suffix.toLowerCase()}`,
    availability: "ready",
  };
}

function legacyState() {
  return {
    schemaVersion: 4,
    revision: 3,
    papers: {
      "OLD-A": {
        paperKey: "OLD-A",
        itemKey: "ITEM-A",
        attachmentKey: "PDF-A",
        title: "Legacy A",
        contentFingerprint: {
          algorithm: "zotero-version-mtime-size-v1",
          value: "fingerprint-a",
          zoteroVersion: 4,
        },
        extractionQuality: "structured",
        indexedAt: "2026-08-28T00:00:00.000Z",
        claimLedger: { claims: [{ id: "claim-a", paperKey: "OLD-A" }] },
        criticalReads: [{ summary: "audit", paperKey: "OLD-A" }],
        reproducibilityReports: [],
        paperToCodeReports: [],
      },
      "OLD-B": {
        paperKey: "OLD-B",
        itemKey: "ITEM-B",
        attachmentKey: "PDF-B",
        title: "Legacy B",
        extractionQuality: "zotero_text",
        criticalReads: [],
        reproducibilityReports: [{ summary: "repro", paperKey: "OLD-B" }],
        paperToCodeReports: [],
      },
      "OLD-C": {
        paperKey: "OLD-C",
        itemKey: "ITEM-C",
        attachmentKey: "PDF-C",
        title: "Legacy C",
        extractionQuality: "unavailable",
        criticalReads: [],
        reproducibilityReports: [],
        paperToCodeReports: [],
      },
    },
    matrices: [
      {
        id: "matrix-old",
        title: "Legacy matrix",
        rows: [
          { paperKey: "OLD-A", cells: [] },
          { paperKey: "OLD-B", cells: [] },
        ],
      },
    ],
    graphs: [{ id: "graph-old", nodes: [{ paperKey: "OLD-A" }] }],
    crossPaperMastery: [],
    crossPaperQuestions: [],
    crossPaperAttempts: [],
    citationContexts: [],
    citationResults: [],
    preferences: {
      responseLanguage: "Korean",
      maxPaperCharacters: 765432,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function setup(
  params: {
    legacy?: unknown;
    resolver?: (request: {
      itemKey: string;
      attachmentKey: string;
      libraryID?: number;
    }) => Promise<LegacySourceResolutionCandidate[]>;
  } = {},
) {
  const files = new MemoryMigrationFiles();
  const rootDir = "/profile/paperpilot-research-workspace";
  const legacyPath = `${rootDir}/workspace-v3.json`;
  if (params.legacy !== undefined) {
    files.files.set(legacyPath, JSON.stringify(params.legacy, null, 2));
  }
  let clock = Date.parse("2026-08-29T00:00:00.000Z");
  const now = () => new Date(clock++);
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir,
    fileOps: files,
    now,
    idFactory: (prefix) => `${prefix}-generated`,
  });
  const importer = new LegacyResearchWorkspaceImporter({
    rootDir,
    legacyPath,
    fileOps: files,
    repository,
    now,
    resolver:
      params.resolver ??
      (async (request) =>
        request.itemKey === "ITEM-A" ? [resolved("A")] : []),
  });
  return { files, rootDir, legacyPath, repository, importer };
}

test("missing legacy workspace is a no-op with no durable write", async () => {
  const context = setup();
  assert.deepEqual(await context.importer.migrate(), { status: "not-found" });
  assert.deepEqual(context.files.writes, []);
});

test("schema-4 import preserves the original and creates stale legacy artifacts", async () => {
  const context = setup({
    legacy: legacyState(),
    resolver: async (request) => {
      if (request.itemKey === "ITEM-A") return [resolved("A")];
      if (request.itemKey === "ITEM-C") {
        return [resolved("C", 1), resolved("C", 2)];
      }
      return [];
    },
  });
  const original = context.files.files.get(context.legacyPath);
  const result = await context.importer.migrate();
  assert.equal(result.status, "completed");
  assert.equal(context.files.files.get(context.legacyPath), original);
  assert.equal(
    context.files.writes.filter((path) => path === context.legacyPath).length,
    0,
  );
  assert.equal(result.marker!.migration.status, "completed");
  assert.deepEqual(result.marker!.migration.summary, {
    migratedSources: 3,
    skippedSources: 0,
    detachedSources: 2,
    ambiguousSources: 1,
    artifactCounts: {
      "claim-ledger": 1,
      "methodology-audit": 1,
      reproducibility: 1,
      "evidence-matrix": 1,
      "relationship-graph": 1,
    },
    warnings: [],
  });

  const projects = await context.repository.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "Imported Research Workspace");
  const project = await context.repository.getProject(projects[0].projectID);
  assert.equal(project.members.length, 3);
  const sources = await Promise.all(
    project.members.map((member) =>
      context.repository.getSource(member.sourceID),
    ),
  );
  const ambiguous = sources.find(
    (entry) => entry?.source.legacyIdentity?.resolution === "ambiguous",
  );
  assert.equal(ambiguous!.source.identity.libraryID, 0);
  assert.equal(ambiguous!.source.availability, "detached");
  assert.equal(
    sources.some((entry) => entry?.source.sourceID === "zotero:2:ITEM-C:PDF-C"),
    false,
  );

  const artifacts = await context.repository.listArtifacts(
    projects[0].projectID,
  );
  assert.equal(artifacts.artifacts.length, 5);
  assert.equal(
    artifacts.artifacts.every((artifact) => artifact.status === "stale"),
    true,
  );
  assert.equal(
    artifacts.artifacts.every(
      (artifact) => artifact.lineage.providerMode === "unknown",
    ),
    true,
  );
  assert.equal(
    artifacts.artifacts.every((artifact) =>
      artifact.staleReasons?.includes("legacy-lineage-incomplete"),
    ),
    true,
  );
  const preferences = await context.repository.getPreferences();
  assert.equal(preferences.preferences.responseLanguage, "Korean");
  assert.equal(preferences.preferences.maxPaperCharacters, 765432);
});

test("a completed matching marker makes migration idempotent", async () => {
  const context = setup({ legacy: legacyState() });
  const first = await context.importer.migrate();
  const projectID = first.marker!.migration.createdProjectID;
  const beforeWrites = context.files.writes.length;
  const beforeArtifacts = (await context.repository.listArtifacts(projectID))
    .artifacts.length;

  const second = await context.importer.migrate();
  assert.equal(second.status, "already-completed");
  assert.equal(context.files.writes.length, beforeWrites);
  assert.equal((await context.repository.listProjects()).length, 1);
  assert.equal(
    (await context.repository.listArtifacts(projectID)).artifacts.length,
    beforeArtifacts,
  );
});

test("an interrupted import resumes with deterministic source and artifact IDs", async () => {
  const context = setup({ legacy: legacyState() });
  context.files.failOnce = (path) => /artifact-.*\.json$/.test(path);
  await assert.rejects(
    () => context.importer.migrate(),
    /Injected migration failure/,
  );
  const markerAfterFailure = JSON.parse(
    context.files.files.get(context.importer.markerPath)!,
  );
  assert.equal(markerAfterFailure.migration.status, "in-progress");
  const projectID = markerAfterFailure.migration.createdProjectID;
  const projectBeforeResume = await context.repository.getProject(projectID);
  const sourceID = projectBeforeResume.members[0].sourceID;
  const sourceBeforeResume = await context.repository.getSource(sourceID);
  await context.repository.putSource(
    { ...sourceBeforeResume!.source, title: "Locally refreshed title" },
    sourceBeforeResume!.revision,
  );
  await context.repository.updateMembers(
    projectID,
    projectBeforeResume.membersRevision,
    (members) =>
      members.map((member) =>
        member.sourceID === sourceID
          ? { ...member, role: "included", reviewStatus: "included" }
          : member,
      ),
  );

  const completed = await context.importer.migrate();
  assert.equal(completed.status, "completed");
  const project = await context.repository.getProject(projectID);
  assert.equal(project.members.length, 3);
  assert.equal(new Set(project.members.map((entry) => entry.sourceID)).size, 3);
  assert.equal(
    (await context.repository.listArtifacts(projectID)).artifacts.length,
    5,
  );
  assert.equal(
    (await context.repository.getSource(sourceID))?.source.title,
    "Locally refreshed title",
  );
  const preservedMember = project.members.find(
    (member) => member.sourceID === sourceID,
  );
  assert.equal(preservedMember?.role, "included");
  assert.equal(preservedMember?.reviewStatus, "included");
});

test("legacy artifacts bind to capabilities and mastery keeps its session envelope", async () => {
  const state = legacyState();
  (
    state.papers["OLD-A"] as (typeof state.papers)["OLD-A"] & {
      mastery: unknown;
    }
  ).mastery = { phase: "active", rounds: [] };
  const context = setup({ legacy: state });
  const result = await context.importer.migrate();
  const projectID = result.marker!.migration.createdProjectID;
  const artifacts = (await context.repository.listArtifacts(projectID))
    .artifacts;

  for (const artifact of artifacts) {
    assert(readResearchWorkspaceArtifact(artifact).capabilityID);
  }
  const mastery = artifacts.find(
    (artifact) => artifact.type === "paper-mastery",
  );
  assert.equal(mastery?.lineage.operation, "paper-mastery");
  assert.deepEqual(mastery?.payload, {
    session: { phase: "active", rounds: [] },
  });
});

test("changed legacy content after a completed import is not rebound or duplicated", async () => {
  const context = setup({ legacy: legacyState() });
  await context.importer.migrate();
  const projectsBefore = await context.repository.listProjects();
  const changed = legacyState();
  changed.papers["OLD-A"].title = "Changed after import";
  context.files.files.set(context.legacyPath, JSON.stringify(changed));

  await assert.rejects(
    () => context.importer.migrate(),
    /changed after migration began/,
  );
  assert.deepEqual(await context.repository.listProjects(), projectsBefore);
});

test("invalid and newer legacy schemas fail before a migration marker is committed", async () => {
  const invalid = setup({ legacy: {} });
  invalid.files.files.set(invalid.legacyPath, "{broken-json");
  await assert.rejects(
    () => invalid.importer.migrate(),
    /contains invalid JSON/,
  );
  assert.equal(invalid.files.files.has(invalid.importer.markerPath), false);

  const newer = setup({ legacy: { schemaVersion: 99 } });
  await assert.rejects(
    () => newer.importer.migrate(),
    /newer than supported schema 4/,
  );
  assert.equal(newer.files.files.has(newer.importer.markerPath), false);
});

test("default Zotero resolver reports every library match instead of choosing first", async () => {
  const globalRecord = globalThis as typeof globalThis & { Zotero?: any };
  const previous = globalRecord.Zotero;
  const parents = new Map<number, any>();
  const byLibraryKey = new Map<string, any>();
  for (const libraryID of [1, 2]) {
    const parent = {
      id: libraryID * 10,
      key: "ITEM-X",
      libraryID,
      getField: (field: string) =>
        field === "title" ? `Paper in library ${libraryID}` : "",
      getCreators: () => [],
    };
    const attachment = {
      id: libraryID * 10 + 1,
      key: "PDF-X",
      libraryID,
      parentItemID: parent.id,
      isAttachment: () => true,
      getFilePathAsync: async () => `/library-${libraryID}/paper.pdf`,
    };
    parents.set(parent.id, parent);
    byLibraryKey.set(`${libraryID}:PDF-X`, attachment);
  }
  globalRecord.Zotero = {
    Libraries: { getAll: () => [{ libraryID: 1 }, { libraryID: 2 }] },
    Items: {
      getByLibraryAndKeyAsync: async (libraryID: number, key: string) =>
        byLibraryKey.get(`${libraryID}:${key}`),
      getAsync: async (id: number) => parents.get(id),
    },
  };
  try {
    const matches = await resolveLegacyZoteroSource({
      itemKey: "ITEM-X",
      attachmentKey: "PDF-X",
    });
    assert.deepEqual(
      matches.map((entry) => entry.sourceID),
      ["zotero:1:ITEM-X:PDF-X", "zotero:2:ITEM-X:PDF-X"],
    );
  } finally {
    if (previous === undefined) delete globalRecord.Zotero;
    else globalRecord.Zotero = previous;
  }
});
