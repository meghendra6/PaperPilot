import { getPref } from "../../utils/prefs";
import { getModeForItem } from "../ai/modeStore";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import { runResearchWorkspaceAnalysis } from "./analysisRunner";
import {
  applyResearchWorkspaceContextPlan,
  planResearchWorkspaceContext,
} from "./contextPlanner";
import { createResearchWorkspaceState } from "./core/researchWorkspace/state";
import { ResearchWorkspaceOperationCoordinator } from "./operationCoordinator";
import { researchWorkspaceOutputSchemaForPurpose } from "./outputSchemas";
import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchProject,
  ResearchWorkspaceArtifact,
  ResearchWorkspaceReviewStatus,
} from "./persistence/contracts";
import { ResearchWorkspaceProjectController } from "./projectController";
import { buildResearchWorkspaceProjectWorkspace } from "./projectWorkspaceBuilder";
import { ResearchWorkspaceService } from "./service";
import type { WorkspaceSupplementalFiles } from "../workspace/supplementalFiles";
import {
  exportResearchWorkspaceTextFile,
  getResearchWorkspaceProjectRepository,
} from "./storage";

export type ResearchWorkspaceSingleOperation =
  | "claims"
  | "critical-read"
  | "reproducibility"
  | "paper-to-code";

export type ResearchWorkspaceMultiOperation =
  | "evidence-matrix"
  | "literature-graph"
  | "cross-paper-mastery";

const sharedHybridIndexes = new Map<string, unknown>();

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function createMemoryRepository(initialState: any) {
  let state = clone(initialState);
  return {
    async load() {
      return clone(state);
    },
    async save(next: any) {
      state = clone(next);
      return clone(state);
    },
    async update(mutator: (draft: any) => unknown | Promise<unknown>) {
      const draft = clone(state);
      const result = await mutator(draft);
      state = clone(result ?? draft);
      state.revision = Number(state.revision || 0) + 1;
      state.updatedAt = new Date().toISOString();
      return clone(state);
    },
  };
}

async function createBoundService(params: {
  anchor: ResearchWorkspacePaper;
  papers: readonly ResearchWorkspacePaper[];
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  seed?: (state: any) => void;
  workspaceFiles?: WorkspaceSupplementalFiles;
}) {
  const preferences =
    await getResearchWorkspaceProjectRepository().getPreferences();
  const state = createResearchWorkspaceState();
  state.preferences.responseLanguage = normalizeResponseLanguage(
    getPref("responseLanguage") ?? preferences.preferences.responseLanguage,
  );
  state.preferences.maxPaperCharacters =
    preferences.preferences.maxPaperCharacters;
  params.seed?.(state);
  const repository = createMemoryRepository(state);
  const service = new (ResearchWorkspaceService as any)({
    repository,
    indexes: sharedHybridIndexes,
    exportTextFile: exportResearchWorkspaceTextFile,
    agent: {
      run: (
        prompt: string,
        purpose: string,
        outputSchema?: Record<string, unknown>,
      ) =>
        runResearchWorkspaceAnalysis({
          itemID: params.anchor.itemID,
          itemTitle: params.anchor.title,
          prompt: params.workspaceFiles
            ? [
                "Read PROJECT_INDEX.md before performing this operation.",
                "Use its bounded source projections and security rules.",
                prompt,
              ].join("\\n\\n")
            : prompt,
          purpose,
          outputSchema,
          workspaceFiles: params.workspaceFiles,
          signal: params.signal,
          onStatus: params.onStatus,
        }),
    },
  });
  for (const paper of params.papers) await service.registerPaper(paper);
  return { service, repository };
}

function projectController() {
  return new ResearchWorkspaceProjectController(
    getResearchWorkspaceProjectRepository(),
  );
}

function operationCoordinator() {
  return new ResearchWorkspaceOperationCoordinator(
    getResearchWorkspaceProjectRepository(),
  );
}

async function prepareProject(
  requestedProjectID: string | undefined,
  papers: readonly ResearchWorkspacePaper[],
) {
  const controller = projectController();
  if (requestedProjectID) {
    await controller.addPapers(requestedProjectID, papers);
    return requestedProjectID;
  }
  return controller.ensureQuickProject(papers);
}

async function latestArtifact(
  projectID: string,
  type: ResearchWorkspaceArtifact["type"],
  sourceIDs: readonly string[],
) {
  const artifacts =
    await getResearchWorkspaceProjectRepository().listArtifacts(projectID);
  return artifacts.artifacts.find(
    (artifact) =>
      artifact.type === type &&
      artifact.status !== "failed" &&
      artifact.status !== "superseded" &&
      sourceIDs.every((sourceID) => artifact.sourceIDs.includes(sourceID)),
  );
}

export async function registerResearchWorkspacePapers(
  _papers: ResearchWorkspacePaper[],
) {
  // Rendering is intentionally side-effect free. Sources are registered only
  // by explicit project creation, add, or analysis actions.
}

export async function searchResearchWorkspacePaper(params: {
  paper: ResearchWorkspacePaper;
  query: string;
}) {
  const { service } = await createBoundService({
    anchor: params.paper,
    papers: [params.paper],
  });
  return service.searchPaper(params.paper, params.query);
}

const SINGLE_OPERATION = {
  claims: {
    artifactType: "claim-ledger",
    title: "Claim–Evidence Ledger",
    operationVersion: "claim-ledger-v1",
  },
  "critical-read": {
    artifactType: "critical-read",
    title: "Critical Read",
    operationVersion: "critical-read-v1",
  },
  reproducibility: {
    artifactType: "reproducibility",
    title: "Reproducibility Audit",
    operationVersion: "reproducibility-v1",
  },
  "paper-to-code": {
    artifactType: "paper-to-code",
    title: "Paper-to-Code",
    operationVersion: "paper-to-code-v1",
  },
} as const;

export async function runResearchWorkspaceSingleOperation(params: {
  paper: ResearchWorkspacePaper;
  operation: ResearchWorkspaceSingleOperation;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const projectID = await prepareProject(params.projectID, [params.paper]);
  const { service } = await createBoundService({
    anchor: params.paper,
    papers: [params.paper],
    signal: params.signal,
    onStatus: params.onStatus,
  });
  const descriptor = SINGLE_OPERATION[params.operation];
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: [params.paper],
    operation: params.operation,
    operationVersion: descriptor.operationVersion,
    artifactType: descriptor.artifactType,
    artifactTitle: descriptor.title,
    providerMode: getModeForItem(params.paper.itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => {
      if (params.operation === "claims")
        return service.extractClaims(params.paper);
      if (params.operation === "critical-read")
        return service.runCriticalRead(params.paper);
      if (params.operation === "reproducibility")
        return service.runReproducibility(params.paper);
      return service.runPaperToCode(params.paper);
    },
  });
  return coordinated.result;
}

export async function startOrResumeResearchWorkspaceMastery(params: {
  paper: ResearchWorkspacePaper;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const projectID = await prepareProject(params.projectID, [params.paper]);
  const previous = await latestArtifact(projectID, "paper-mastery", [
    params.paper.sourceID,
  ]);
  const priorSession = (previous?.payload as any)?.session;
  const { service } = await createBoundService({
    anchor: params.paper,
    papers: [params.paper],
    signal: params.signal,
    onStatus: params.onStatus,
  });
  if (priorSession) {
    await service.env.repository.update((state: any) => {
      state.papers[params.paper.paperKey].mastery = priorSession;
    });
  }
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: [params.paper],
    operation: "paper-mastery",
    operationVersion: "paper-mastery-v2",
    artifactType: "paper-mastery",
    artifactTitle: "Paper Mastery",
    providerMode: getModeForItem(params.paper.itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => service.startOrResumeMastery(params.paper),
  });
  return coordinated.result;
}

export async function submitResearchWorkspaceMastery(params: {
  paper: ResearchWorkspacePaper;
  answer: string;
  confidence?: number;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const projectID = await prepareProject(params.projectID, [params.paper]);
  const previous = await latestArtifact(projectID, "paper-mastery", [
    params.paper.sourceID,
  ]);
  const priorSession = (previous?.payload as any)?.session;
  if (!priorSession) throw new Error("Start Paper Mastery first.");
  const { service } = await createBoundService({
    anchor: params.paper,
    papers: [params.paper],
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await service.env.repository.update((state: any) => {
    state.papers[params.paper.paperKey].mastery = priorSession;
  });
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: [params.paper],
    operation: "paper-mastery-grade",
    operationVersion: "paper-mastery-v2",
    artifactType: "paper-mastery",
    artifactTitle: "Paper Mastery",
    providerMode: getModeForItem(params.paper.itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () =>
      service.submitMastery(params.paper, params.answer, params.confidence),
  });
  return coordinated.result;
}

const MULTI_OPERATION = {
  "evidence-matrix": {
    artifactType: "evidence-matrix",
    title: "Evidence Matrix",
    operationVersion: "evidence-matrix-v1",
  },
  "literature-graph": {
    artifactType: "relationship-graph",
    title: "Relationship Graph",
    operationVersion: "relationship-graph-v1",
  },
  "cross-paper-mastery": {
    artifactType: "cross-paper-mastery",
    title: "Cross-paper Mastery",
    operationVersion: "cross-paper-mastery-v1",
  },
} as const;

function multiOperationPurpose(operation: ResearchWorkspaceMultiOperation) {
  if (operation === "evidence-matrix") return "matrix-project-row";
  if (operation === "literature-graph") return "literature-graph";
  return "cross-paper-question";
}

export async function runResearchWorkspaceMultiOperation(params: {
  papers: ResearchWorkspacePaper[];
  operation: ResearchWorkspaceMultiOperation;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.papers.length < 2) {
    throw new Error("Select at least two papers in the Zotero item list.");
  }
  const projectID = await prepareProject(params.projectID, params.papers);
  const contextPlan = planResearchWorkspaceContext({
    papers: params.papers,
    operation: params.operation,
  });
  const projectedPapers = applyResearchWorkspaceContextPlan(
    params.papers,
    contextPlan,
  );
  const descriptor = MULTI_OPERATION[params.operation];
  const details = await projectController().details(projectID);
  const purpose = multiOperationPurpose(params.operation);
  const projectWorkspace = buildResearchWorkspaceProjectWorkspace({
    details,
    papers: projectedPapers,
    contextPlan,
    descriptor: {
      operation: params.operation,
      operationVersion: descriptor.operationVersion,
      promptVersion: `${params.operation}-prompt-v1`,
      parserVersion: `${params.operation}-parser-v1`,
    },
    outputSchema: researchWorkspaceOutputSchemaForPurpose(purpose),
  });
  const { service } = await createBoundService({
    anchor: projectedPapers[0],
    papers: projectedPapers,
    signal: params.signal,
    onStatus: params.onStatus,
    workspaceFiles: projectWorkspace.files,
  });
  const projectionFingerprints = new Map(
    contextPlan.projections.map((projection) => [
      projection.sourceID,
      projection.fingerprint,
    ]),
  );
  if (params.operation === "evidence-matrix") {
    const matrix = service.createEvidenceMatrixShell(projectedPapers);
    const initialPayload = {
      matrix,
      coverage: service.evidenceMatrixCoverage(matrix),
      contextPlan,
    };
    const units = projectedPapers.map((paper) => ({
      unitID: paper.sourceID,
      sourceID: paper.sourceID,
      paper,
    }));
    const coordinated = await operationCoordinator().runIncremental<
      typeof initialPayload,
      (typeof units)[number],
      any
    >({
      projectID,
      sourcesPrepared: true,
      papers: params.papers,
      operation: params.operation,
      operationVersion: descriptor.operationVersion,
      artifactType: descriptor.artifactType,
      artifactTitle: descriptor.title,
      providerMode: getModeForItem(params.papers[0].itemID),
      contextProjectionFingerprints: projectionFingerprints,
      initialPayload,
      units,
      signal: params.signal,
      onStatus: params.onStatus,
      executeUnit: (unit) =>
        service.extractEvidenceMatrixRow(matrix, unit.paper),
      mergeUnit: (payload, _unit, row) => {
        const nextMatrix = service.mergeEvidenceMatrixRow(payload.matrix, row);
        return {
          ...payload,
          matrix: nextMatrix,
          coverage: service.evidenceMatrixCoverage(nextMatrix),
        };
      },
      reusableUnit: (payload, unit) =>
        payload.matrix.rows.find(
          (row: any) => row.paperKey === unit.paper.paperKey,
        ),
      validateReusableUnit: (unit, row) =>
        row?.paperKey === unit.paper.paperKey && Array.isArray(row?.cells),
    });
    return coordinated.result;
  }
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: params.papers,
    operation: params.operation,
    operationVersion: descriptor.operationVersion,
    artifactType: descriptor.artifactType,
    artifactTitle: descriptor.title,
    providerMode: getModeForItem(params.papers[0].itemID),
    contextProjectionFingerprints: projectionFingerprints,
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => {
      if (params.operation === "literature-graph")
        return service
          .createLiteratureGraph(projectedPapers)
          .then((result: any) => ({ ...result, contextPlan }));
      return service
        .startCrossPaperMastery(projectedPapers)
        .then((result: any) => ({ ...result, contextPlan }));
    },
  });
  return coordinated.result;
}

export async function runResearchWorkspaceProjectSynthesis(params: {
  papers: ResearchWorkspacePaper[];
  question: string;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.papers.length < 2) {
    throw new Error("Project synthesis requires at least two papers.");
  }
  const question = params.question.trim();
  if (!question) throw new Error("Enter a project question.");
  const projectID = await prepareProject(params.projectID, params.papers);
  const contextPlan = planResearchWorkspaceContext({
    papers: params.papers,
    operation: "project-synthesis",
    query: question,
  });
  if (contextPlan.insufficientCoverage) {
    params.onStatus?.(
      "Context coverage is limited; the synthesis will narrow unsupported claims.",
    );
  }
  const projectedPapers = applyResearchWorkspaceContextPlan(
    params.papers,
    contextPlan,
  );
  const details = await projectController().details(projectID);
  const admittedSourceIDs = new Set(
    params.papers.map((paper) => paper.sourceID),
  );
  const localFreshnessWarnings = [
    ...details.warnings,
    ...details.sources
      .filter(
        (source) =>
          admittedSourceIDs.has(source.sourceID) &&
          source.availability !== "ready",
      )
      .map(
        (source) =>
          `${source.title} is currently ${source.availability}; historical evidence may not be navigable.`,
      ),
    ...details.artifacts
      .filter(
        (artifact) =>
          artifact.status === "stale" &&
          artifact.sourceIDs.some((sourceID) =>
            admittedSourceIDs.has(sourceID),
          ),
      )
      .map(
        (artifact) =>
          `${artifact.title} v${artifact.version} is stale and was not treated as current evidence.`,
      ),
    ...(contextPlan.insufficientCoverage
      ? ["One or more sources have insufficient bounded context coverage."]
      : []),
  ];
  const coverage = {
    totalProjectSources: details.members.length,
    analyzedSources: params.papers.length,
    excludedSources: details.members
      .filter(
        (member) =>
          member.reviewStatus === "excluded" ||
          !admittedSourceIDs.has(member.sourceID),
      )
      .map((member) => ({
        sourceID: member.sourceID,
        reason:
          member.exclusionReason ??
          (member.reviewStatus === "excluded"
            ? "Excluded without a recorded reason."
            : "Not included in the immutable run snapshot."),
      })),
    contextPlan: {
      plannerVersion: contextPlan.plannerVersion,
      fingerprint: contextPlan.fingerprint,
      requestedBudget: contextPlan.requestedBudget,
      usedCharacters: contextPlan.usedCharacters,
      omittedCharacters: contextPlan.omittedCharacters,
      insufficientCoverage: contextPlan.insufficientCoverage,
      sources: contextPlan.projections.map((projection) => ({
        sourceID: projection.sourceID,
        coverage: projection.coverage,
        includedCharacters: projection.includedCharacters,
        omittedCharacters: projection.omittedCharacters,
        insufficient: projection.insufficient,
      })),
    },
    freshnessWarnings: [...new Set(localFreshnessWarnings)],
  };
  const descriptor = {
    operation: "project-synthesis",
    operationVersion: "project-synthesis-v1",
    promptVersion: "project-synthesis-prompt-v1",
    parserVersion: "project-synthesis-parser-v1",
  };
  const projectWorkspace = buildResearchWorkspaceProjectWorkspace({
    details,
    papers: projectedPapers,
    contextPlan,
    descriptor,
    outputSchema: researchWorkspaceOutputSchemaForPurpose("project-synthesis"),
  });
  const { service } = await createBoundService({
    anchor: projectedPapers[0],
    papers: projectedPapers,
    signal: params.signal,
    onStatus: params.onStatus,
    workspaceFiles: projectWorkspace.files,
  });
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: params.papers,
    operation: descriptor.operation,
    operationVersion: descriptor.operationVersion,
    artifactType: "synthesis",
    artifactTitle: "Project Synthesis",
    providerMode:
      details.project.defaultEngineMode ??
      getModeForItem(params.papers[0].itemID),
    contextProjectionFingerprints: new Map(
      contextPlan.projections.map((projection) => [
        projection.sourceID,
        projection.fingerprint,
      ]),
    ),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () =>
      service
        .createProjectSynthesis(projectedPapers, question, coverage)
        .then((result: any) => ({
          ...result,
          freshnessWarnings: [
            ...new Set([
              ...(result.freshnessWarnings ?? []),
              ...localFreshnessWarnings,
            ]),
          ],
          contextPlan,
        })),
  });
  return coordinated.result;
}

export async function submitResearchWorkspaceCrossPaperMastery(params: {
  papers: ResearchWorkspacePaper[];
  sessionID: string;
  answer: string;
  confidence?: number;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.papers.length < 2) {
    throw new Error("Select at least two papers in the Zotero item list.");
  }
  const projectID = await prepareProject(params.projectID, params.papers);
  const previous = await latestArtifact(projectID, "cross-paper-mastery", [
    ...params.papers.map((paper) => paper.sourceID),
  ]);
  const priorSession = (previous?.payload as any)?.session;
  if (!priorSession || priorSession.id !== params.sessionID) {
    throw new Error("Cross-paper session not found.");
  }
  const contextPlan = planResearchWorkspaceContext({
    papers: params.papers,
    operation: "cross-paper-mastery-grade",
  });
  const projectedPapers = applyResearchWorkspaceContextPlan(
    params.papers,
    contextPlan,
  );
  const details = await projectController().details(projectID);
  const gradeDescriptor = {
    operation: "cross-paper-mastery-grade",
    operationVersion: "cross-paper-mastery-v1",
    promptVersion: "cross-paper-mastery-grade-prompt-v1",
    parserVersion: "cross-paper-mastery-grade-parser-v1",
  };
  const projectWorkspace = buildResearchWorkspaceProjectWorkspace({
    details,
    papers: projectedPapers,
    contextPlan,
    descriptor: gradeDescriptor,
    outputSchema: researchWorkspaceOutputSchemaForPurpose("cross-paper-grade"),
  });
  const { service } = await createBoundService({
    anchor: projectedPapers[0],
    papers: projectedPapers,
    signal: params.signal,
    onStatus: params.onStatus,
    workspaceFiles: projectWorkspace.files,
  });
  await service.env.repository.update((state: any) => {
    state.crossPaperMastery = [priorSession];
    state.crossPaperQuestions = priorSession.questions ?? [];
  });
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: params.papers,
    operation: gradeDescriptor.operation,
    operationVersion: gradeDescriptor.operationVersion,
    artifactType: "cross-paper-mastery",
    artifactTitle: "Cross-paper Mastery",
    providerMode: getModeForItem(params.papers[0].itemID),
    contextProjectionFingerprints: new Map(
      contextPlan.projections.map((projection) => [
        projection.sourceID,
        projection.fingerprint,
      ]),
    ),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () =>
      service
        .submitCrossPaperMastery(
          params.sessionID,
          projectedPapers,
          params.answer,
          params.confidence,
        )
        .then((result: any) => ({ ...result, contextPlan })),
  });
  return coordinated.result;
}

export async function classifyResearchWorkspaceCitations(params: {
  anchor: ResearchWorkspacePaper;
  contexts: unknown[];
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const projectID = await prepareProject(params.projectID, [params.anchor]);
  const { service } = await createBoundService({
    anchor: params.anchor,
    papers: [params.anchor],
    signal: params.signal,
    onStatus: params.onStatus,
  });
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: [params.anchor],
    operation: "citation-stance",
    operationVersion: "citation-stance-v1",
    artifactType: "citation-stance",
    artifactTitle: "Citation Stance",
    providerMode: getModeForItem(params.anchor.itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () =>
      service.classifyCitationContexts(params.contexts, [params.anchor]),
  });
  return coordinated.result;
}

function projectMarkdown(
  value: Awaited<
    ReturnType<ResearchWorkspaceProjectController["exportProject"]>
  >,
) {
  const lines = [
    `# ${value.project.name}`,
    "",
    value.project.researchQuestion
      ? `Research question: ${value.project.researchQuestion}`
      : "",
    "",
    `Papers: ${value.members.length}`,
    `Artifacts: ${value.artifacts.length}`,
    "",
  ];
  for (const artifact of value.artifacts) {
    lines.push(
      `## ${artifact.title} · v${artifact.version}`,
      "",
      `Status: ${artifact.status}`,
      "",
      "```json",
      JSON.stringify(artifact.payload, null, 2),
      "```",
      "",
    );
  }
  if (value.warnings.length) {
    lines.push(
      "## Export warnings",
      "",
      ...value.warnings.map((item) => `- ${item}`),
    );
  }
  return `${lines.filter((line, index) => line || lines[index - 1]).join("\n")}\n`;
}

export async function exportIntegratedResearchWorkspace(params: {
  anchor?: ResearchWorkspacePaper;
  projectID?: string;
  onStatus?: (status: string) => void;
}) {
  if (!params.projectID && !params.anchor) {
    throw new Error("Choose a project to export.");
  }
  const projectID =
    params.projectID ?? (await prepareProject(undefined, [params.anchor!]));
  params.onStatus?.("Preparing project-scoped export…");
  const exported = await projectController().exportProject(projectID);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = exported.project.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const [jsonPath, markdownPath] = await Promise.all([
    exportResearchWorkspaceTextFile(
      `${baseName}-${stamp}.json`,
      `${JSON.stringify(exported, null, 2)}\n`,
    ),
    exportResearchWorkspaceTextFile(
      `${baseName}-${stamp}.md`,
      projectMarkdown(exported),
    ),
  ]);
  return { jsonPath, markdownPath, warnings: exported.warnings };
}

export function loadResearchWorkspaceHome() {
  return projectController().home();
}

export function loadResearchWorkspaceProject(projectID: string) {
  return projectController().details(projectID);
}

export function createResearchWorkspaceProject(params: {
  name: string;
  description?: string;
  researchQuestion?: string;
  papers?: readonly ResearchWorkspacePaper[];
}) {
  return projectController().createProject(
    {
      name: params.name,
      description: params.description,
      researchQuestion: params.researchQuestion,
    },
    params.papers,
  );
}

export function addPapersToResearchWorkspaceProject(
  projectID: string,
  papers: readonly ResearchWorkspacePaper[],
) {
  return projectController().addPapers(projectID, papers);
}

export function updateResearchWorkspaceProject(
  projectID: string,
  patch: Pick<
    Partial<ResearchProject>,
    "name" | "description" | "researchQuestion" | "scope" | "defaultEngineMode"
  >,
) {
  return projectController().updateProject(projectID, patch);
}

export function updateResearchWorkspaceMember(params: {
  projectID: string;
  sourceID: string;
  reviewStatus: ResearchWorkspaceReviewStatus;
  exclusionReason?: string;
  userNote?: string;
}) {
  return projectController().updateMember(params);
}

export function archiveResearchWorkspaceProject(projectID: string) {
  return projectController().archiveProject(projectID);
}

export function deleteResearchWorkspaceProject(projectID: string) {
  return projectController().deleteProject(projectID);
}

export async function loadResearchWorkspaceState() {
  const preferences =
    await getResearchWorkspaceProjectRepository().getPreferences();
  return {
    papers: {},
    matrices: [],
    graphs: [],
    preferences: preferences.preferences,
  };
}
