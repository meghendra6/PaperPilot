import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  applyResearchWorkspaceContextPlan,
  planResearchWorkspaceContext,
} from "../src/modules/researchWorkspace/contextPlanner";
import {
  finalizeProjectSynthesisEvidence,
  parseProjectSynthesisResponse,
} from "../src/modules/researchWorkspace/core/synthesis/parser";
import { validateAndAnnotateRelationshipGraph } from "../src/modules/researchWorkspace/core/literatureGraph/provenance";
import { ResearchWorkspaceOperationCoordinator } from "../src/modules/researchWorkspace/operationCoordinator";
import { researchWorkspaceArtifactPayloadFingerprint } from "../src/modules/researchWorkspace/artifactFingerprint";
import { researchWorkspaceOutputSchemaForPurpose } from "../src/modules/researchWorkspace/outputSchemas";
import type { ResearchWorkspacePaper } from "../src/modules/researchWorkspace/paperSource";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import { ResearchWorkspaceProjectController } from "../src/modules/researchWorkspace/projectController";
import { buildResearchWorkspaceProjectWorkspace } from "../src/modules/researchWorkspace/projectWorkspaceBuilder";
import { ResearchWorkspaceService } from "../src/modules/researchWorkspace/service";
import { validateWorkspaceSupplementalFilePath } from "../src/modules/workspace/supplementalFiles";

class MemoryFiles implements ResearchWorkspaceFileOps {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly writes: string[] = [];

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
  }

  async listDirectory(path: string) {
    const prefix = `${path.replace(/[\\/]+$/, "")}/`;
    return [...this.files.keys()].filter((entry) => entry.startsWith(prefix));
  }
}

function createRepository() {
  const files = new MemoryFiles();
  let time = Date.parse("2026-08-30T00:00:00.000Z");
  const counts = new Map<string, number>();
  const repository = new ResearchWorkspaceProjectRepository({
    rootDir: "/profile/research-workspace",
    fileOps: files,
    now: () => new Date(time++),
    idFactory: (prefix) => {
      const next = (counts.get(prefix) ?? 0) + 1;
      counts.set(prefix, next);
      return `${prefix}-${next}`;
    },
  });
  return { files, repository };
}

function paper(
  suffix: string,
  fingerprint = `fingerprint-${suffix}`,
  context = `${suffix} contribution method evidence limitation. `.repeat(30),
): ResearchWorkspacePaper {
  const sourceID = `zotero:1:ITEM-${suffix}:PDF-${suffix}`;
  return {
    sourceID,
    paperKey: sourceID,
    libraryID: 1,
    itemKey: `ITEM-${suffix}`,
    itemID: suffix.charCodeAt(0),
    attachmentID: suffix.charCodeAt(0) + 100,
    attachmentKey: `PDF-${suffix}`,
    contentFingerprint: {
      algorithm: "zotero-version-mtime-size-v1",
      value: fingerprint,
    },
    title: `Paper ${suffix}`,
    context,
    extractionQuality: "zotero_text",
  };
}

test("total context planning is deterministic, bounded, and keeps every source", () => {
  const papers = [paper("B"), paper("A")];
  const first = planResearchWorkspaceContext({
    papers,
    operation: "project-synthesis",
    query: "method evidence",
    totalCharacters: 120,
    minimumCharactersPerSource: 20,
  });
  const second = planResearchWorkspaceContext({
    papers: [...papers].reverse(),
    operation: "project-synthesis",
    query: "method evidence",
    totalCharacters: 120,
    minimumCharactersPerSource: 20,
  });
  assert.deepEqual(first, second);
  assert(first.usedCharacters <= 120);
  assert.deepEqual(
    first.projections.map((projection) => projection.sourceID),
    [...papers.map((entry) => entry.sourceID)].sort(),
  );
  assert(
    first.projections.every((projection) => projection.includedCharacters > 0),
  );
  const projected = applyResearchWorkspaceContextPlan(papers, first);
  for (const entry of projected) {
    assert.match(entry.context, /<paper source_id=/);
    assert.match(entry.context, /<\/paper>/);
  }
  const changed = planResearchWorkspaceContext({
    papers: [paper("B", "changed"), paper("A")],
    operation: "project-synthesis",
    query: "method evidence",
    totalCharacters: 120,
    minimumCharactersPerSource: 20,
  });
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test("structured operations pass their provider schema", async () => {
  let captured: unknown;
  const service = new (ResearchWorkspaceService as any)({
    repository: {},
    agent: {
      async run(_prompt: string, _purpose: string, schema: unknown) {
        captured = schema;
        return "{}";
      },
    },
  });
  await service.run("Prompt", "project-synthesis");
  assert.deepEqual(
    captured,
    researchWorkspaceOutputSchemaForPurpose("project-synthesis"),
  );
});

test("project synthesis rejects foreign sources and closes unsupported claims", () => {
  const parsed = parseProjectSynthesisResponse({
    response: JSON.stringify({
      answer: "Bounded answer.",
      claims: [
        {
          statement: "Claim",
          sourceIDs: ["S1"],
          evidence: [],
          support: "verified",
        },
      ],
      agreements: [],
      contradictions: [],
      unresolvedUncertainty: ["Missing result detail"],
      freshnessWarnings: [],
    }),
    allowedSourceIDs: new Set(["S1"]),
    allowedAttachmentKeys: new Set(["A1"]),
  });
  assert.equal(parsed.claims[0].support, "inferred");
  const finalized = finalizeProjectSynthesisEvidence({
    ...parsed,
    claims: [
      {
        ...parsed.claims[0],
        evidence: [{ verification: { status: "verified" } }],
      },
    ],
  });
  assert.equal(finalized.claims[0].paperSupported, true);
  assert.throws(
    () =>
      parseProjectSynthesisResponse({
        response: JSON.stringify({
          answer: "Answer",
          claims: [
            {
              statement: "Foreign claim",
              sourceIDs: ["OTHER"],
              evidence: [],
            },
          ],
        }),
        allowedSourceIDs: new Set(["S1"]),
        allowedAttachmentKeys: new Set(["A1"]),
      }),
    /unknown SourceID/,
  );
});

test("relationship graph verification requires qualifying local provenance", () => {
  const papers = [paper("A"), paper("B")];
  const base = {
    id: "graph",
    nodes: papers.map((entry, index) => ({
      id: `p${index + 1}`,
      kind: "paper",
      paperKey: entry.sourceID,
      label: entry.title,
    })),
    edges: [
      {
        id: "edge-1",
        source: "p1",
        target: "p2",
        kind: "extends",
        verified: true,
        evidence: [
          {
            sourceID: papers[0].sourceID,
            attachmentKey: papers[0].attachmentKey,
            verification: { status: "verified" },
          },
        ],
      },
    ],
  };
  const graph = validateAndAnnotateRelationshipGraph({
    graph: base,
    papers,
    operationVersion: "relationship-graph-v1",
  });
  assert.equal(graph.edges[0].provenance, "local-evidence");
  assert.equal(graph.edges[0].verificationState, "verified");
  assert.equal(graph.edges[0].userReviewState, "unreviewed");
  assert.throws(
    () =>
      validateAndAnnotateRelationshipGraph({
        graph: {
          ...base,
          edges: [{ ...base.edges[0], evidence: [] }],
        },
        papers,
        operationVersion: "relationship-graph-v1",
      }),
    /without qualifying provenance/,
  );
});

test("project workspace pack has bounded per-paper files and no absolute paths", () => {
  const papers = [paper("A"), paper("B")];
  const contextPlan = planResearchWorkspaceContext({
    papers,
    operation: "evidence-matrix",
    totalCharacters: 200,
  });
  const workspace = buildResearchWorkspaceProjectWorkspace({
    details: {
      project: {
        projectID: "project-1",
        name: "Project",
        artifactIDs: [],
        runIDs: [],
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
      },
      projectRevision: 0,
      members: papers.map((entry) => ({
        sourceID: entry.sourceID,
        role: "candidate" as const,
        reviewStatus: "unreviewed" as const,
        addedAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
      })),
      membersRevision: 0,
      sources: [],
      artifacts: [],
      warnings: [],
    },
    papers,
    contextPlan,
    descriptor: {
      operation: "evidence-matrix",
      operationVersion: "evidence-matrix-v1",
      promptVersion: "evidence-matrix-prompt-v1",
      parserVersion: "evidence-matrix-parser-v1",
    },
    outputSchema: researchWorkspaceOutputSchemaForPurpose("matrix-project-row"),
  });
  assert(workspace.files["PROJECT_INDEX.md"]);
  assert(workspace.files["project.json"]);
  assert(workspace.files["operation.json"]);
  assert(workspace.files["output-schema.json"]);
  assert.equal(
    Object.keys(workspace.files).filter((path) => path.endsWith("/paper.md"))
      .length,
    2,
  );
  assert(
    Object.keys(workspace.files).every(
      (path) => !path.startsWith("/") && !path.includes(".."),
    ),
  );
  assert.throws(
    () => validateWorkspaceSupplementalFilePath("../outside.json"),
    /Unsafe/,
  );
});

test("incremental runs preserve rows and reuse only matching fingerprints", async () => {
  const { repository } = createRepository();
  const projects = new ResearchWorkspaceProjectController(repository);
  const coordinator = new ResearchWorkspaceOperationCoordinator(repository);
  const papers = [paper("A"), paper("B"), paper("C")];
  const details = await projects.createProject({ name: "Incremental" }, papers);
  const units = papers.map((entry) => ({
    unitID: entry.sourceID,
    sourceID: entry.sourceID,
  }));
  const initialPayload = {
    rows: [] as Array<{ sourceID: string; version: number }>,
  };
  const shared = {
    projectID: details.project.projectID,
    papers,
    operation: "evidence-matrix",
    operationVersion: "evidence-matrix-v1",
    artifactType: "evidence-matrix" as const,
    artifactTitle: "Evidence Matrix",
    providerMode: "codex_cli" as const,
    initialPayload,
    units,
    sourcesPrepared: true,
    mergeUnit: (
      payload: typeof initialPayload,
      _unit: (typeof units)[number],
      result: { sourceID: string; version: number },
    ) => ({ rows: [...payload.rows, result] }),
    reusableUnit: (
      payload: typeof initialPayload,
      unit: (typeof units)[number],
    ) => payload.rows.find((row) => row.sourceID === unit.sourceID),
    validateReusableUnit: (
      unit: (typeof units)[number],
      result: { sourceID: string },
    ) => result.sourceID === unit.sourceID,
  };
  const first = await coordinator.runIncremental({
    ...shared,
    executeUnit: async (unit) => {
      if (unit.sourceID === papers[1].sourceID) {
        throw new Error("Injected row failure");
      }
      return { sourceID: unit.sourceID, version: 1 };
    },
  });
  assert.equal(first.artifact.artifact.status, "partial");
  assert.deepEqual(first.artifact.artifact.checkpoint?.completedUnits, [
    papers[0].sourceID,
    papers[2].sourceID,
  ]);
  assert.equal(first.result.rows.length, 2);

  const changedPapers = [papers[0], papers[1], paper("C", "fingerprint-C-2")];
  const executed: string[] = [];
  const resumed = await coordinator.runIncremental({
    ...shared,
    papers: changedPapers,
    executeUnit: async (unit) => {
      executed.push(unit.sourceID);
      return { sourceID: unit.sourceID, version: 2 };
    },
  });
  assert.deepEqual(executed, [papers[1].sourceID, papers[2].sourceID]);
  assert.equal(resumed.artifact.artifact.status, "complete");
  assert.deepEqual(
    resumed.result.rows.map((row) => row.version),
    [1, 2, 2],
  );
});

test("cancellation checkpoints completed units and blocks late completion", async () => {
  const { repository } = createRepository();
  const projects = new ResearchWorkspaceProjectController(repository);
  const coordinator = new ResearchWorkspaceOperationCoordinator(repository);
  const papers = [paper("A"), paper("B")];
  const details = await projects.createProject({ name: "Cancel" }, papers);
  const units = papers.map((entry) => ({
    unitID: entry.sourceID,
    sourceID: entry.sourceID,
  }));
  const controller = new AbortController();
  await assert.rejects(
    coordinator.runIncremental({
      projectID: details.project.projectID,
      papers,
      operation: "evidence-matrix",
      operationVersion: "evidence-matrix-v1",
      artifactType: "evidence-matrix",
      artifactTitle: "Evidence Matrix",
      providerMode: "codex_cli",
      initialPayload: { rows: [] as string[] },
      units,
      sourcesPrepared: true,
      signal: controller.signal,
      executeUnit: async (unit) => {
        if (unit.sourceID === papers[1].sourceID) controller.abort();
        return unit.sourceID;
      },
      mergeUnit: (payload, _unit, result) => ({
        rows: [...payload.rows, result],
      }),
      reusableUnit: (payload, unit) =>
        payload.rows.find((sourceID) => sourceID === unit.sourceID),
    }),
    /Cancelled/,
  );
  const artifacts = await repository.listArtifacts(details.project.projectID);
  const partial = artifacts.artifacts.find(
    (artifact) => artifact.status === "partial",
  );
  assert(partial);
  assert.deepEqual(partial.checkpoint?.completedUnits, [papers[0].sourceID]);
  assert.deepEqual(partial.checkpoint?.pendingUnits, [papers[1].sourceID]);
  const runs = await repository.listRuns(details.project.projectID);
  assert.equal(runs.runs[0].status, "cancelled");
});

test("project ownership rejects concurrency and ignores an aborted late result", async () => {
  const { repository } = createRepository();
  const projects = new ResearchWorkspaceProjectController(repository);
  const coordinator = new ResearchWorkspaceOperationCoordinator(repository);
  const papers = [paper("A"), paper("B")];
  const details = await projects.createProject({ name: "Owner" }, papers);
  let resolve!: (value: { ok: boolean }) => void;
  let started!: () => void;
  const began = new Promise<void>((next) => {
    started = next;
  });
  const deferred = new Promise<{ ok: boolean }>((next) => {
    resolve = next;
  });
  const controller = new AbortController();
  const first = coordinator.run({
    projectID: details.project.projectID,
    papers,
    sourcesPrepared: true,
    operation: "synthesis",
    operationVersion: "synthesis-v1",
    artifactType: "synthesis",
    artifactTitle: "Synthesis",
    providerMode: "codex_cli",
    signal: controller.signal,
    execute: async () => {
      started();
      return deferred;
    },
  });
  await began;
  await assert.rejects(
    coordinator.run({
      projectID: details.project.projectID,
      papers,
      sourcesPrepared: true,
      operation: "relationship-graph",
      operationVersion: "relationship-graph-v1",
      artifactType: "relationship-graph",
      artifactTitle: "Graph",
      providerMode: "codex_cli",
      execute: async () => ({ nodes: [], edges: [] }),
    }),
    /active for this project/,
  );
  controller.abort();
  resolve({ ok: true });
  await assert.rejects(first, /Cancelled/);
  const artifacts = await repository.listArtifacts(details.project.projectID);
  assert.equal(artifacts.artifacts.length, 0);
});

test("local derived operations run without a live selection and preserve dependencies", async () => {
  const { repository } = createRepository();
  const projects = new ResearchWorkspaceProjectController(repository);
  const coordinator = new ResearchWorkspaceOperationCoordinator(repository);
  const papers = [paper("B"), paper("A")];
  const created = await projects.createProject({ name: "Derived" }, papers);
  const upstream = await coordinator.run({
    projectID: created.project.projectID,
    papers,
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "claims-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [] }),
  });
  const details = await projects.details(created.project.projectID);
  const input = {
    artifactID: upstream.artifact.artifact.artifactID,
    artifactType: upstream.artifact.artifact.type,
    version: upstream.artifact.artifact.version,
    updatedAt: upstream.artifact.artifact.updatedAt,
    payloadFingerprint: researchWorkspaceArtifactPayloadFingerprint(
      upstream.artifact.artifact.payload,
    ),
  } as const;
  const first = await coordinator.runDerived({
    projectID: created.project.projectID,
    sources: [...details.sources].reverse(),
    artifactInputs: [input],
    membersRevision: details.membersRevision,
    operation: "contradiction-gap-dashboard",
    operationVersion: "contradiction-gap-dashboard-v1",
    promptVersion: "local-artifact-derivation-v1",
    parserVersion: "contradiction-gap-parser-v1",
    schemaVersion: "contradiction-gap-dashboard-v1",
    artifactType: "contradiction-gap-dashboard",
    artifactTitle: "Contradictions & Evidence Gaps",
    execute: () => ({ kind: "research-workspace-contradiction-gap-dashboard" }),
  });
  assert.equal(first.run.run.status, "completed");
  assert.equal(first.artifact.artifact.lineage.providerMode, "local");
  assert.equal(
    first.artifact.artifact.lineage.membersRevision,
    details.membersRevision,
  );
  assert.deepEqual(first.artifact.artifact.lineage.artifactInputs, [input]);
  assert.deepEqual(first.artifact.artifact.sourceIDs, [
    papers[1].sourceID,
    papers[0].sourceID,
  ]);

  await coordinator.runDerived({
    projectID: created.project.projectID,
    sources: details.sources,
    artifactInputs: [input],
    membersRevision: details.membersRevision,
    operation: "contradiction-gap-dashboard",
    operationVersion: "contradiction-gap-dashboard-v1",
    promptVersion: "local-artifact-derivation-v1",
    parserVersion: "contradiction-gap-parser-v1",
    schemaVersion: "contradiction-gap-dashboard-v1",
    artifactType: "contradiction-gap-dashboard",
    artifactTitle: "Contradictions & Evidence Gaps",
    execute: () => ({ kind: "research-workspace-contradiction-gap-dashboard" }),
  });
  const previous = await repository.getArtifact(
    created.project.projectID,
    first.artifact.artifact.artifactID,
  );
  assert.equal(previous?.artifact.status, "superseded");
  await assert.rejects(
    coordinator.runDerived({
      projectID: created.project.projectID,
      sources: details.sources,
      artifactInputs: [],
      operation: "empty-derived",
      operationVersion: "v1",
      promptVersion: "v1",
      parserVersion: "v1",
      schemaVersion: "v1",
      artifactType: "contradiction-gap-dashboard",
      artifactTitle: "Empty",
      execute: () => ({}),
    }),
    /upstream artifact is required/,
  );
});

test("local derived operations reject an upstream artifact changed during execution", async () => {
  const { repository } = createRepository();
  const projects = new ResearchWorkspaceProjectController(repository);
  const coordinator = new ResearchWorkspaceOperationCoordinator(repository);
  const papers = [paper("RACE")];
  const created = await projects.createProject(
    { name: "Derived race" },
    papers,
  );
  const upstream = await coordinator.run({
    projectID: created.project.projectID,
    papers,
    sourcesPrepared: true,
    operation: "claims",
    operationVersion: "claims-v1",
    artifactType: "claim-ledger",
    artifactTitle: "Claims",
    providerMode: "codex_cli",
    execute: async () => ({ claims: [{ text: "Before" }] }),
  });
  const details = await projects.details(created.project.projectID);
  const input = {
    artifactID: upstream.artifact.artifact.artifactID,
    artifactType: upstream.artifact.artifact.type,
    version: upstream.artifact.artifact.version,
    updatedAt: upstream.artifact.artifact.updatedAt,
    payloadFingerprint: researchWorkspaceArtifactPayloadFingerprint(
      upstream.artifact.artifact.payload,
    ),
  } as const;

  await assert.rejects(
    coordinator.runDerived({
      projectID: created.project.projectID,
      sources: details.sources,
      artifactInputs: [input],
      membersRevision: details.membersRevision,
      operation: "contradiction-gap-dashboard",
      operationVersion: "contradiction-gap-dashboard-v1",
      promptVersion: "local-artifact-derivation-v1",
      parserVersion: "contradiction-gap-parser-v1",
      schemaVersion: "contradiction-gap-dashboard-v1",
      artifactType: "contradiction-gap-dashboard",
      artifactTitle: "Contradictions & Evidence Gaps",
      execute: async () => {
        const current = await repository.getArtifact(
          created.project.projectID,
          input.artifactID,
        );
        assert(current);
        await repository.updateArtifact(
          created.project.projectID,
          input.artifactID,
          current.revision,
          (artifact) => ({
            ...artifact,
            payload: { claims: [{ text: "After" }] },
          }),
        );
        return { kind: "research-workspace-contradiction-gap-dashboard" };
      },
    }),
    /Upstream artifact .* changed/,
  );
  const artifacts = await repository.listArtifacts(created.project.projectID);
  assert.equal(
    artifacts.artifacts.filter(
      (artifact) => artifact.type === "contradiction-gap-dashboard",
    ).length,
    0,
  );
  const runs = await repository.listRuns(created.project.projectID);
  assert.equal(runs.runs.at(-1)?.status, "failed");
});
