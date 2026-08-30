import { getPref } from "../../utils/prefs";
import { getLibraryItemCandidates } from "../relatedRecommendations";
import { getModeForItem } from "../ai/modeStore";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import { runResearchWorkspaceAnalysis } from "./analysisRunner";
import {
  extractResearchWorkspaceCitationContexts as extractCitationContexts,
  type CitationContextExtractionResult,
} from "./citationContextExtraction";
import {
  getResearchWorkspaceCapability,
  type ResearchWorkspaceCapabilityID,
} from "./capabilityRegistry";
import {
  applyResearchWorkspaceContextPlan,
  planResearchWorkspaceContext,
} from "./contextPlanner";
import { verifyResearchWorkspaceEvidence } from "./evidenceVerification";
import { createResearchWorkspaceState } from "./core/researchWorkspace/state";
import {
  getEvidenceMatrixPreset,
  type EvidenceMatrixPresetID,
} from "./evidenceMatrixPresets";
import { ResearchWorkspaceOperationCoordinator } from "./operationCoordinator";
import { createResearchWorkspacePublicPayload } from "./artifactRenderer";
import { researchWorkspaceOutputSchemaForPurpose } from "./outputSchemas";
import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchProject,
  ResearchWorkspaceArtifact,
  ResearchWorkspaceReviewStatus,
} from "./persistence/contracts";
import { ResearchWorkspaceProjectController } from "./projectController";
import {
  createResearchWorkspaceProjectTemplatePreview,
  listResearchWorkspaceProjectTemplates,
  renderResearchWorkspaceProjectTemplateMarkdown,
  serializeResearchWorkspaceProjectTemplateJSON,
  type ResearchWorkspaceProjectTemplatePreview,
} from "./projectTemplates";
import { buildResearchWorkspaceProjectWorkspace } from "./projectWorkspaceBuilder";
import {
  crossPaperMasterySnapshotMatches,
  getCrossPaperMasteryCurrentQuestion,
  isCrossPaperMasterySubmissionReplay,
  isPersistentCrossPaperMasterySession,
  type PersistentCrossPaperMasterySession,
} from "./masteryPersistence";
import { ResearchWorkspaceService } from "./service";
import {
  applyCitationStanceCorrection,
  type CitationStanceValue,
} from "./core/citationStance/corrections";
import {
  serializeResearchWorkspaceScreeningLogCsv,
  type RecordResearchWorkspaceScreeningDecisionInput,
  type ResearchWorkspaceScreeningLog,
} from "./screeningLog";
import {
  applyContradictionGapReview,
  buildContradictionGapDashboard,
  type ContradictionClassification,
  type ContradictionGapDashboard,
} from "./contradictionGap";
import {
  buildCitationHealthReport,
  citationHealthDerivedLineage,
  collectCitationHealthLocalLibrarySnapshot,
  type CitationHealthDraftInput,
  type CitationHealthExternalProviderSnapshot,
} from "./citationHealth";
import type { WorkspaceSupplementalFiles } from "../workspace/supplementalFiles";
import {
  exportResearchWorkspaceTextFile,
  getResearchWorkspaceLivingReviewService,
  getResearchWorkspaceProjectRepository,
  getResearchWorkspaceZoteroSyncService,
} from "./storage";
import type {
  ResearchWorkspaceZoteroSyncPreview,
  ResearchWorkspaceZoteroSyncSelection,
} from "./zoteroSync";

export type ResearchWorkspaceSingleOperation =
  | "claims"
  | "methodology-audit"
  | "reproducibility"
  | "paper-to-code";

export type ResearchWorkspaceMultiOperation =
  | "evidence-matrix"
  | "quick-compare"
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
  const expectedSourceIDs = [...new Set(sourceIDs)].sort();
  return artifacts.artifacts.find((artifact) => {
    const artifactSourceIDs = [...new Set(artifact.sourceIDs)].sort();
    return (
      artifact.type === type &&
      artifact.status !== "failed" &&
      artifact.status !== "superseded" &&
      artifactSourceIDs.length === expectedSourceIDs.length &&
      artifactSourceIDs.every(
        (sourceID, index) => sourceID === expectedSourceIDs[index],
      )
    );
  });
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

const SINGLE_CAPABILITY: Record<
  ResearchWorkspaceSingleOperation,
  ResearchWorkspaceCapabilityID
> = {
  claims: "claim-ledger",
  "methodology-audit": "methodology-audit",
  reproducibility: "reproducibility-audit",
  "paper-to-code": "paper-to-code",
};

function normalizeSingleOperation(
  operation: ResearchWorkspaceSingleOperation | "critical-read",
): ResearchWorkspaceSingleOperation {
  return operation === "critical-read" ? "methodology-audit" : operation;
}

export async function runResearchWorkspaceSingleOperation(params: {
  paper: ResearchWorkspacePaper;
  operation: ResearchWorkspaceSingleOperation | "critical-read";
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
  const operation = normalizeSingleOperation(params.operation);
  const descriptor = getResearchWorkspaceCapability(
    SINGLE_CAPABILITY[operation],
  );
  if (!descriptor.artifactType) {
    throw new Error(`${descriptor.label} does not produce a project artifact.`);
  }
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers: [params.paper],
    operation: descriptor.operation,
    operationVersion: descriptor.operationVersion,
    promptVersion: descriptor.promptVersion,
    parserVersion: descriptor.parserVersion,
    schemaVersion: descriptor.schemaVersion,
    artifactType: descriptor.artifactType,
    artifactTitle: descriptor.label,
    providerMode: getModeForItem(params.paper.itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => {
      if (operation === "claims") return service.extractClaims(params.paper);
      if (operation === "methodology-audit")
        return service.runMethodologyAudit(params.paper);
      if (operation === "reproducibility")
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

const MULTI_CAPABILITY: Record<
  ResearchWorkspaceMultiOperation,
  ResearchWorkspaceCapabilityID
> = {
  "evidence-matrix": "evidence-matrix",
  "quick-compare": "quick-compare",
  "literature-graph": "relationship-graph",
  "cross-paper-mastery": "cross-paper-mastery",
};

function multiOperationPurpose(operation: ResearchWorkspaceMultiOperation) {
  if (operation === "evidence-matrix" || operation === "quick-compare")
    return "matrix-project-row";
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
  let priorCrossSession: PersistentCrossPaperMasterySession | undefined;
  if (params.operation === "cross-paper-mastery") {
    const previous = await latestArtifact(
      projectID,
      "cross-paper-mastery",
      params.papers.map((paper) => paper.sourceID),
    );
    const candidate = (previous?.payload as any)?.session;
    if (
      isPersistentCrossPaperMasterySession(candidate) &&
      crossPaperMasterySnapshotMatches(candidate, projectID, params.papers)
    ) {
      priorCrossSession = candidate;
      const currentQuestion = getCrossPaperMasteryCurrentQuestion(candidate);
      if (currentQuestion) {
        return {
          ...(previous?.payload as Record<string, unknown>),
          session: candidate,
          question: currentQuestion,
          resumed: true,
        };
      }
    }
  }
  const contextPlan = planResearchWorkspaceContext({
    papers: params.papers,
    operation: params.operation,
  });
  const projectedPapers = applyResearchWorkspaceContextPlan(
    params.papers,
    contextPlan,
  );
  const descriptor = getResearchWorkspaceCapability(
    MULTI_CAPABILITY[params.operation],
  );
  if (!descriptor.artifactType) {
    throw new Error(`${descriptor.label} does not produce a project artifact.`);
  }
  const details = await projectController().details(projectID);
  const purpose = multiOperationPurpose(params.operation);
  const projectWorkspace = buildResearchWorkspaceProjectWorkspace({
    details,
    papers: projectedPapers,
    contextPlan,
    descriptor: {
      operation: descriptor.operation,
      operationVersion: descriptor.operationVersion,
      promptVersion: descriptor.promptVersion,
      parserVersion: descriptor.parserVersion,
    },
    outputSchema: researchWorkspaceOutputSchemaForPurpose(purpose),
  });
  const { service } = await createBoundService({
    anchor: projectedPapers[0],
    papers: projectedPapers,
    signal: params.signal,
    onStatus: params.onStatus,
    workspaceFiles: projectWorkspace.files,
    ...(priorCrossSession
      ? {
          seed: (state: any) => {
            state.crossPaperMastery = [priorCrossSession];
            state.crossPaperQuestions = priorCrossSession.questions ?? [];
            state.crossPaperAttempts = priorCrossSession.attempts ?? [];
          },
        }
      : {}),
  });
  const projectionFingerprints = new Map(
    contextPlan.projections.map((projection) => [
      projection.sourceID,
      projection.fingerprint,
    ]),
  );
  if (
    params.operation === "evidence-matrix" ||
    params.operation === "quick-compare"
  ) {
    const presetID: EvidenceMatrixPresetID =
      params.operation === "quick-compare" ? "quick-compare-v1" : "full";
    const preset = getEvidenceMatrixPreset(presetID);
    const matrix = service.createEvidenceMatrixShell(projectedPapers, presetID);
    const initialPayload = {
      matrix,
      coverage: service.evidenceMatrixCoverage(matrix),
      contextPlan,
      preset: {
        id: preset.id,
        version: preset.version,
        label: preset.label,
      },
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
      operation: descriptor.operation,
      operationVersion: descriptor.operationVersion,
      promptVersion: descriptor.promptVersion,
      parserVersion: descriptor.parserVersion,
      schemaVersion: descriptor.schemaVersion,
      artifactType: descriptor.artifactType,
      artifactTitle: descriptor.label,
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
    operation: descriptor.operation,
    operationVersion: descriptor.operationVersion,
    promptVersion: descriptor.promptVersion,
    parserVersion: descriptor.parserVersion,
    schemaVersion: descriptor.schemaVersion,
    artifactType: descriptor.artifactType,
    artifactTitle: descriptor.label,
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
        .startCrossPaperMastery(projectedPapers, priorCrossSession, projectID)
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
  expectedRevision: number;
  submissionID: string;
  answer: string;
  confidence?: number;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.papers.length < 2) {
    throw new Error("Select at least two papers in the Zotero item list.");
  }
  if (!params.submissionID.trim()) {
    throw new Error("Cross-paper mastery requires a submission ID.");
  }
  if (
    !Number.isInteger(params.expectedRevision) ||
    params.expectedRevision < 0
  ) {
    throw new Error("Cross-paper mastery requires a valid expected revision.");
  }
  const projectID = await prepareProject(params.projectID, params.papers);
  const previous = await latestArtifact(projectID, "cross-paper-mastery", [
    ...params.papers.map((paper) => paper.sourceID),
  ]);
  const priorSession = (previous?.payload as any)?.session;
  if (
    !isPersistentCrossPaperMasterySession(priorSession) ||
    priorSession.id !== params.sessionID ||
    !crossPaperMasterySnapshotMatches(priorSession, projectID, params.papers)
  ) {
    throw new Error("Cross-paper session not found.");
  }
  const duplicate = priorSession.attempts.find(
    (attempt) => attempt.id === params.submissionID,
  );
  if (duplicate) {
    const duplicateQuestion = priorSession.questions.find(
      (question) => question.id === duplicate.questionId,
    );
    if (
      !duplicateQuestion ||
      !isCrossPaperMasterySubmissionReplay({
        attempt: duplicate,
        questionID: duplicateQuestion.id,
        answer: params.answer,
        learnerConfidence: params.confidence,
      })
    ) {
      throw new Error(
        "Cross-paper mastery idempotency conflict: this submission ID was already used for different input.",
      );
    }
    return previous?.payload;
  }
  if (priorSession.revision !== params.expectedRevision) {
    throw new Error(
      `Cross-paper mastery revision conflict: expected ${params.expectedRevision}, found ${priorSession.revision}.`,
    );
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
    operation: "cross-paper-mastery",
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
          params.expectedRevision,
          params.submissionID,
        )
        .then((result: any) => ({ ...result, contextPlan })),
  });
  return coordinated.result;
}

export async function extractResearchWorkspaceCitationContexts(params: {
  papers: ResearchWorkspacePaper[];
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (!params.papers.length) throw new Error("Choose at least one local PDF.");
  if (params.signal?.aborted) throw params.signal.reason;
  const projectID = await prepareProject(params.projectID, params.papers);
  params.onStatus?.("Reading local citation markers and bibliography entries…");
  const libraries = [...new Set(params.papers.map((paper) => paper.libraryID))];
  const candidateGroups = await Promise.all(
    libraries.map(async (libraryID) => {
      try {
        return await getLibraryItemCandidates(libraryID);
      } catch {
        return [];
      }
    }),
  );
  if (params.signal?.aborted) throw params.signal.reason;
  const descriptor = getResearchWorkspaceCapability("citation-context");
  const coordinated =
    await operationCoordinator().run<CitationContextExtractionResult>({
      projectID,
      sourcesPrepared: true,
      papers: params.papers,
      operation: descriptor.operation,
      operationVersion: descriptor.operationVersion,
      artifactType: "citation-context",
      artifactTitle: "Citation Context Extraction",
      providerMode: getModeForItem(params.papers[0].itemID),
      signal: params.signal,
      onStatus: params.onStatus,
      execute: async () => {
        const extracted = extractCitationContexts({
          papers: params.papers,
          libraryCandidates: candidateGroups.flat(),
        });
        return (await verifyResearchWorkspaceEvidence(
          extracted,
          params.papers,
        )) as CitationContextExtractionResult;
      },
    });
  return coordinated.result;
}

export async function classifyResearchWorkspaceCitations(params: {
  anchor: ResearchWorkspacePaper;
  contexts: unknown[];
  papers?: ResearchWorkspacePaper[];
  extraction?: CitationContextExtractionResult;
  approvedForModel: boolean;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.approvedForModel !== true) {
    throw new Error(
      "Citation snippets require explicit approval before stance analysis.",
    );
  }
  const papers = params.papers?.length ? params.papers : [params.anchor];
  const projectID = await prepareProject(params.projectID, papers);
  const { service } = await createBoundService({
    anchor: params.anchor,
    papers,
    signal: params.signal,
    onStatus: params.onStatus,
  });
  const coordinated = await operationCoordinator().run<any>({
    projectID,
    sourcesPrepared: true,
    papers,
    operation: "citation-stance",
    operationVersion: "citation-stance-v1",
    artifactType: "citation-stance",
    artifactTitle: "Citation Stance",
    providerMode: getModeForItem(params.anchor.itemID),
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () =>
      service.classifyCitationContexts(
        params.contexts,
        papers,
        params.extraction,
        params.approvedForModel,
      ),
  });
  return coordinated.result;
}

export async function correctResearchWorkspaceCitationStance(params: {
  papers: ResearchWorkspacePaper[];
  payload: Record<string, unknown>;
  contextID: string;
  stance: CitationStanceValue;
  reason: string;
  expectedRevision: number;
  submissionID: string;
  projectID?: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (!params.papers.length) throw new Error("Choose at least one local PDF.");
  const projectID = await prepareProject(params.projectID, params.papers);
  const coordinated = await operationCoordinator().run<Record<string, unknown>>(
    {
      projectID,
      sourcesPrepared: true,
      papers: params.papers,
      operation: "citation-stance-correction",
      operationVersion: "citation-stance-correction-v1",
      artifactType: "citation-stance",
      artifactTitle: "Citation Stance",
      providerMode: getModeForItem(params.papers[0].itemID),
      signal: params.signal,
      onStatus: params.onStatus,
      execute: async () =>
        applyCitationStanceCorrection({
          payload: params.payload,
          contextID: params.contextID,
          stance: params.stance,
          reason: params.reason,
          expectedRevision: params.expectedRevision,
          submissionID: params.submissionID,
          eventID: `citation-correction-${params.submissionID}`,
        }),
    },
  );
  return coordinated.result;
}

function projectMarkdown(
  value: Awaited<
    ReturnType<ResearchWorkspaceProjectController["exportProject"]>
  > & { reviewLog?: ResearchWorkspaceScreeningLog },
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
  if (value.project.templateSnapshot) {
    lines.push(
      ...renderResearchWorkspaceProjectTemplateMarkdown(value.project)
        .trimEnd()
        .split("\n"),
      "",
    );
  }
  if (value.reviewLog) {
    lines.push(
      "## Screening & exclusion log",
      "",
      `Included: ${value.reviewLog.summary.include}`,
      `Excluded: ${value.reviewLog.summary.exclude}`,
      `Maybe: ${value.reviewLog.summary.maybe}`,
      `Unreviewed: ${value.reviewLog.summary.unreviewed}`,
      `Decision events: ${value.reviewLog.summary.decisions}`,
      "",
      "| Paper | Decision | Stage | Reason |",
      "| --- | --- | --- | --- |",
      ...value.reviewLog.rows.map((row) => {
        const decision =
          row.current?.decision ?? row.legacyDecision ?? "unreviewed";
        const stage = row.current?.stage ?? "—";
        const reason = row.current?.reason?.text ?? "—";
        const cell = (entry: string) =>
          entry.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
        return `| ${cell(row.title)} | ${cell(decision)} | ${cell(stage)} | ${cell(reason)} |`;
      }),
      "",
    );
  }
  for (const artifact of value.artifacts) {
    const publicPayload = createResearchWorkspacePublicPayload(
      artifact.payload,
      artifact.type,
    );
    lines.push(
      `## ${artifact.title} · v${artifact.version}`,
      "",
      `Status: ${artifact.status}`,
      "",
      "```json",
      JSON.stringify(publicPayload, null, 2),
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
  const [exported, reviewLog] = await Promise.all([
    projectController().exportProject(projectID),
    projectController().screeningLog(projectID),
  ]);
  const publicExport = {
    ...exported,
    reviewLog,
    artifacts: exported.artifacts.map((artifact) => ({
      ...artifact,
      payload: createResearchWorkspacePublicPayload(
        artifact.payload,
        artifact.type,
      ),
    })),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = exported.project.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const [jsonPath, markdownPath] = await Promise.all([
    exportResearchWorkspaceTextFile(
      `${baseName}-${stamp}.json`,
      `${JSON.stringify(publicExport, null, 2)}\n`,
    ),
    exportResearchWorkspaceTextFile(
      `${baseName}-${stamp}.md`,
      projectMarkdown(publicExport),
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

export function loadResearchWorkspaceScreeningLog(projectID: string) {
  return projectController().screeningLog(projectID);
}

export async function runResearchWorkspaceContradictionGapDashboard(params: {
  projectID: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  const details = await projectController().details(params.projectID);
  const dashboard = buildContradictionGapDashboard({
    details,
    generatedAt: new Date().toISOString(),
  });
  if (!dashboard.scope.includedSourceIDs.length) {
    throw new Error(
      "This project has no non-excluded sources for contradiction analysis.",
    );
  }
  if (!dashboard.inputArtifacts.length) {
    throw new Error(
      "Build a current Claim Ledger, Evidence Matrix, Synthesis, Methodology Audit, or Reproducibility artifact first.",
    );
  }
  const sourceByID = new Map(
    details.sources.map((source) => [source.sourceID, source]),
  );
  const sources = dashboard.scope.includedSourceIDs
    .map((sourceID) => sourceByID.get(sourceID))
    .filter((source): source is NonNullable<typeof source> => Boolean(source));
  return operationCoordinator().runDerived({
    projectID: params.projectID,
    sources,
    artifactInputs: dashboard.inputArtifacts.map((input) => ({
      artifactID: input.artifactID,
      artifactType: input.artifactType,
      version: input.version,
      updatedAt: input.updatedAt,
      payloadFingerprint: input.payloadFingerprint,
    })),
    membersRevision: dashboard.scope.membersRevision,
    operation: "contradiction-gap-dashboard",
    operationVersion: "contradiction-gap-dashboard-v1",
    promptVersion: "local-artifact-derivation-v1",
    parserVersion: "contradiction-gap-parser-v1",
    schemaVersion: "contradiction-gap-dashboard-v1",
    artifactType: "contradiction-gap-dashboard",
    artifactTitle: "Contradictions & Evidence Gaps",
    providerMode: "local",
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => dashboard,
  });
}

export async function runResearchWorkspaceCitationHealth(params: {
  projectID: string;
  draft?: CitationHealthDraftInput;
  externalProvider?: CitationHealthExternalProviderSnapshot;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}) {
  if (params.signal?.aborted) throw params.signal.reason;
  const details = await projectController().details(params.projectID);
  const includedSourceIDs = new Set(
    details.members
      .filter((member) => member.reviewStatus !== "excluded")
      .map((member) => member.sourceID),
  );
  const includedSources = details.sources
    .filter((source) => includedSourceIDs.has(source.sourceID))
    .sort((left, right) => left.sourceID.localeCompare(right.sourceID));
  if (!includedSources.length) {
    throw new Error(
      "This project has no non-excluded sources for citation health review.",
    );
  }
  params.onStatus?.("Reading current local Zotero reference metadata…");
  const localLibrary = await collectCitationHealthLocalLibrarySnapshot(
    includedSources.map((source) => source.identity.libraryID),
  );
  if (params.signal?.aborted) throw params.signal.reason;
  params.onStatus?.("Building the local citation and reference checklist…");
  const report = buildCitationHealthReport({
    details,
    localLibrary,
    generatedAt: new Date().toISOString(),
    ...(params.draft ? { draft: params.draft } : {}),
    ...(params.externalProvider
      ? { externalProvider: params.externalProvider }
      : {}),
  });
  if (!report.inputArtifacts.length) {
    throw new Error(
      "Build a current Citation Context, Citation Stance, Methodology Audit, or Reproducibility artifact first.",
    );
  }
  const derivedLineage = citationHealthDerivedLineage(report);
  const sourceByID = new Map(
    includedSources.map((source) => [source.sourceID, source]),
  );
  const derivedSources = derivedLineage.sourceIDs
    .map((sourceID) => sourceByID.get(sourceID))
    .filter((source): source is NonNullable<typeof source> => Boolean(source));
  return operationCoordinator().runDerived({
    projectID: params.projectID,
    sources: derivedSources,
    artifactInputs: derivedLineage.artifactInputs,
    membersRevision: derivedLineage.membersRevision,
    operation: "citation-reference-health",
    operationVersion: "citation-reference-health-v1",
    promptVersion: "local-artifact-derivation-v1",
    parserVersion: "citation-reference-health-parser-v1",
    schemaVersion: "citation-reference-health-v1",
    artifactType: "citation-health",
    artifactTitle: "Citation & Reference Health",
    providerMode: "local",
    signal: params.signal,
    onStatus: params.onStatus,
    execute: () => report,
  });
}

export async function reviewResearchWorkspaceContradictionGap(params: {
  projectID: string;
  artifactID: string;
  relationshipID: string;
  action: "confirm" | "reclassify" | "dismiss";
  toClassification?: ContradictionClassification;
  reason?: string;
  submissionID: string;
  expectedDashboardRevision: number;
}) {
  const repository = getResearchWorkspaceProjectRepository();
  const file = await repository.getArtifact(
    params.projectID,
    params.artifactID,
  );
  if (!file || file.artifact.type !== "contradiction-gap-dashboard") {
    throw new Error("Contradiction dashboard artifact was not found.");
  }
  if (file.artifact.status !== "complete") {
    throw new Error("Refresh the stale or superseded dashboard before review.");
  }
  if (!params.submissionID.trim()) {
    throw new Error("A review submission ID is required.");
  }
  const dashboard = file.artifact.payload as ContradictionGapDashboard;
  if (
    dashboard.kind !== "research-workspace-contradiction-gap-dashboard" ||
    dashboard.projectID !== params.projectID
  ) {
    throw new Error("Contradiction dashboard payload is invalid.");
  }
  const next = applyContradictionGapReview({
    dashboard,
    input: {
      relationshipID: params.relationshipID,
      action: params.action,
      ...(params.toClassification
        ? { toClassification: params.toClassification }
        : {}),
      ...(params.reason ? { reason: params.reason } : {}),
      submissionID: params.submissionID,
      expectedDashboardRevision: params.expectedDashboardRevision,
    },
    eventID: `contradiction-review-${params.submissionID}`,
    reviewedAt: new Date().toISOString(),
  });
  if (next === dashboard) return file;
  return repository.updateArtifact(
    params.projectID,
    params.artifactID,
    file.revision,
    (artifact) => ({ ...artifact, payload: next }),
  );
}

export function updateResearchWorkspaceScreeningProtocol(params: {
  projectID: string;
  expectedProjectRevision: number;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
}) {
  return projectController().updateScreeningProtocol(params);
}

export function recordResearchWorkspaceScreeningDecision(
  params: RecordResearchWorkspaceScreeningDecisionInput,
) {
  return projectController().recordScreeningDecision(params);
}

export async function exportResearchWorkspaceScreeningLog(projectID: string) {
  const [details, log] = await Promise.all([
    projectController().details(projectID),
    projectController().screeningLog(projectID),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = details.project.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const [jsonPath, csvPath] = await Promise.all([
    exportResearchWorkspaceTextFile(
      `${baseName}-screening-log-${stamp}.json`,
      `${JSON.stringify(log, null, 2)}\n`,
    ),
    exportResearchWorkspaceTextFile(
      `${baseName}-screening-log-${stamp}.csv`,
      serializeResearchWorkspaceScreeningLogCsv(log),
    ),
  ]);
  return { jsonPath, csvPath, log };
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

export function listResearchWorkspaceProjectTemplateOptions() {
  return listResearchWorkspaceProjectTemplates();
}

export function previewResearchWorkspaceProjectTemplate(templateID: string) {
  return createResearchWorkspaceProjectTemplatePreview(templateID);
}

export function createResearchWorkspaceProjectFromTemplate(
  preview: ResearchWorkspaceProjectTemplatePreview,
  papers?: readonly ResearchWorkspacePaper[],
) {
  return projectController().createProjectFromTemplate(preview, papers);
}

export function updateResearchWorkspaceProjectTemplateSettings(params: {
  projectID: string;
  expectedProjectRevision: number;
  assumptions: ResearchWorkspaceProjectTemplatePreview["assumptions"];
  capabilityPresetIDs: string[];
}) {
  return projectController().updateTemplateSettings(params);
}

export async function exportResearchWorkspaceProjectTemplateState(
  projectID: string,
) {
  const details = await projectController().details(projectID);
  return {
    json: serializeResearchWorkspaceProjectTemplateJSON(details.project),
    markdown: renderResearchWorkspaceProjectTemplateMarkdown(details.project),
  };
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

export function loadResearchWorkspaceChangeInbox(projectID: string) {
  return getResearchWorkspaceLivingReviewService().load(projectID);
}

export function checkResearchWorkspaceChanges(projectID: string) {
  return getResearchWorkspaceLivingReviewService().checkProject(projectID);
}

export function resolveResearchWorkspaceChange(params: {
  projectID: string;
  changeID: string;
  action: "reviewed" | "dismissed";
  submissionID: string;
  expectedRevision: number;
}) {
  return getResearchWorkspaceLivingReviewService().resolveChange(params);
}

export function refreshResearchWorkspaceSource(params: {
  projectID: string;
  sourceID: string;
}) {
  return getResearchWorkspaceLivingReviewService().refreshSource(
    params.projectID,
    params.sourceID,
  );
}

export function listResearchWorkspaceZoteroSyncTargets(projectID: string) {
  return getResearchWorkspaceZoteroSyncService().listTargets(projectID);
}

export function previewResearchWorkspaceZoteroSync(params: {
  projectID: string;
  selection: ResearchWorkspaceZoteroSyncSelection;
}) {
  return getResearchWorkspaceZoteroSyncService().preview(params);
}

export function applyResearchWorkspaceZoteroSync(params: {
  preview: ResearchWorkspaceZoteroSyncPreview;
  approvalToken: string;
}) {
  return getResearchWorkspaceZoteroSyncService().apply(params);
}

export function listResearchWorkspaceZoteroSyncReceipts(projectID: string) {
  return getResearchWorkspaceZoteroSyncService().listReceipts(projectID);
}

export function undoResearchWorkspaceZoteroSync(params: {
  projectID: string;
  receiptID: string;
  expectedRevision: number;
}) {
  return getResearchWorkspaceZoteroSyncService().undo(params);
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
