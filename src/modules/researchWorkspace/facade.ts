import { getPref } from "../../utils/prefs";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import { runResearchWorkspaceAnalysis } from "./analysisRunner";
import type { ResearchWorkspacePaper } from "./paperSource";
import { ResearchWorkspaceService } from "./service";
import {
  exportResearchWorkspaceTextFile,
  getResearchWorkspaceRepository,
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

async function createBoundService(params: {
  anchor: ResearchWorkspacePaper;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const repository = getResearchWorkspaceRepository();
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
  const state = await service.state();
  const responseLanguage = normalizeResponseLanguage(
    getPref("responseLanguage"),
  );
  if (state.preferences.responseLanguage !== responseLanguage) {
    await service.configure({ responseLanguage });
  }
  return service;
}

async function registerPapers(service: any, papers: ResearchWorkspacePaper[]) {
  for (const paper of papers) await service.registerPaper(paper);
}

export async function registerResearchWorkspacePapers(
  papers: ResearchWorkspacePaper[],
) {
  if (!papers.length) return;
  const service = await createBoundService({ anchor: papers[0] });
  await registerPapers(service, papers);
}

export async function searchResearchWorkspacePaper(params: {
  paper: ResearchWorkspacePaper;
  query: string;
}) {
  const service = await createBoundService({ anchor: params.paper });
  await registerPapers(service, [params.paper]);
  return service.searchPaper(params.paper, params.query);
}

export async function runResearchWorkspaceSingleOperation(params: {
  paper: ResearchWorkspacePaper;
  operation: ResearchWorkspaceSingleOperation;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const service = await createBoundService({
    anchor: params.paper,
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await registerPapers(service, [params.paper]);
  if (params.operation === "claims") return service.extractClaims(params.paper);
  if (params.operation === "critical-read")
    return service.runCriticalRead(params.paper);
  if (params.operation === "reproducibility")
    return service.runReproducibility(params.paper);
  return service.runPaperToCode(params.paper);
}

export async function startOrResumeResearchWorkspaceMastery(params: {
  paper: ResearchWorkspacePaper;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const service = await createBoundService({
    anchor: params.paper,
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await registerPapers(service, [params.paper]);
  return service.startOrResumeMastery(params.paper);
}

export async function submitResearchWorkspaceMastery(params: {
  paper: ResearchWorkspacePaper;
  answer: string;
  confidence?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const service = await createBoundService({
    anchor: params.paper,
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await registerPapers(service, [params.paper]);
  return service.submitMastery(params.paper, params.answer, params.confidence);
}

export async function runResearchWorkspaceMultiOperation(params: {
  papers: ResearchWorkspacePaper[];
  operation: ResearchWorkspaceMultiOperation;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.papers.length < 2) {
    throw new Error("Select at least two papers in the Zotero item list.");
  }
  const service = await createBoundService({
    anchor: params.papers[0],
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await registerPapers(service, params.papers);
  if (params.operation === "evidence-matrix")
    return service.createEvidenceMatrix(params.papers);
  if (params.operation === "literature-graph")
    return service.createLiteratureGraph(params.papers);
  return service.startCrossPaperMastery(params.papers);
}

export async function submitResearchWorkspaceCrossPaperMastery(params: {
  papers: ResearchWorkspacePaper[];
  sessionID: string;
  answer: string;
  confidence?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.papers.length < 2) {
    throw new Error("Select at least two papers in the Zotero item list.");
  }
  const service = await createBoundService({
    anchor: params.papers[0],
    signal: params.signal,
    onStatus: params.onStatus,
  });
  await registerPapers(service, params.papers);
  return service.submitCrossPaperMastery(
    params.sessionID,
    params.papers,
    params.answer,
    params.confidence,
  );
}

export async function classifyResearchWorkspaceCitations(params: {
  anchor: ResearchWorkspacePaper;
  contexts: unknown[];
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const service = await createBoundService(params);
  await registerPapers(service, [params.anchor]);
  return service.classifyCitationContexts(params.contexts);
}

export async function exportIntegratedResearchWorkspace(params: {
  anchor: ResearchWorkspacePaper;
  onStatus?: (status: string) => void;
}) {
  const service = await createBoundService(params);
  return service.exportWorkspace();
}

export async function loadResearchWorkspaceState() {
  return getResearchWorkspaceRepository().load();
}
