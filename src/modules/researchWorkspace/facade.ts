import { getPref } from "../../utils/prefs";
import { getModeForItem } from "../ai/modeStore";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import { runResearchWorkspaceAnalysis } from "./analysisRunner";
import { createResearchWorkspaceState } from "./core/researchWorkspace/state";
import { ResearchWorkspaceOperationCoordinator } from "./operationCoordinator";
import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchProject,
  ResearchWorkspaceArtifact,
  ResearchWorkspaceReviewStatus,
} from "./persistence/contracts";
import { ResearchWorkspaceProjectController } from "./projectController";
import { ResearchWorkspaceService } from "./service";
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
      run: (prompt: string, purpose: string) =>
        runResearchWorkspaceAnalysis({
          itemID: params.anchor.itemID,
          itemTitle: params.anchor.title,
          prompt,
          purpose,
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
  const { service } = await createBoundService({
    anchor: params.papers[0],
    papers: params.papers,
    signal: params.signal,
    onStatus: params.onStatus,
  });
  const descriptor = MULTI_OPERATION[params.operation];
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: params.papers,
    operation: params.operation,
    operationVersion: descriptor.operationVersion,
    artifactType: descriptor.artifactType,
    artifactTitle: descriptor.title,
    providerMode: getModeForItem(params.papers[0].itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => {
      if (params.operation === "evidence-matrix")
        return service.createEvidenceMatrix(params.papers);
      if (params.operation === "literature-graph")
        return service.createLiteratureGraph(params.papers);
      return service.startCrossPaperMastery(params.papers);
    },
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
  const { service } = await createBoundService({
    anchor: params.papers[0],
    papers: params.papers,
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await service.env.repository.update((state: any) => {
    state.crossPaperMastery = [priorSession];
    state.crossPaperQuestions = priorSession.questions ?? [];
  });
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: params.papers,
    operation: "cross-paper-mastery-grade",
    operationVersion: "cross-paper-mastery-v1",
    artifactType: "cross-paper-mastery",
    artifactTitle: "Cross-paper Mastery",
    providerMode: getModeForItem(params.papers[0].itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () =>
      service.submitCrossPaperMastery(
        params.sessionID,
        params.papers,
        params.answer,
        params.confidence,
      ),
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
