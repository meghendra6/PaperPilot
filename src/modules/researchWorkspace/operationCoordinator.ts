import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchWorkspaceArtifactFile,
  ResearchWorkspaceArtifactStatus,
  ResearchWorkspaceArtifactType,
  ResearchWorkspaceEngineMode,
  ResearchWorkspaceRunFile,
} from "./persistence/contracts";
import type { ResearchWorkspaceProjectRepository } from "./persistence/projectRepository";
import { ResearchWorkspaceProjectController } from "./projectController";

export interface ResearchWorkspaceOperationResult<T> {
  projectID: string;
  result: T;
  artifact: ResearchWorkspaceArtifactFile<T>;
  run: ResearchWorkspaceRunFile;
}

export interface RunResearchWorkspaceProjectOperation<T> {
  projectID?: string;
  papers: readonly ResearchWorkspacePaper[];
  operation: string;
  operationVersion: string;
  artifactType: ResearchWorkspaceArtifactType;
  artifactTitle: string;
  providerMode: ResearchWorkspaceEngineMode;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  execute: () => Promise<T>;
  status?: ResearchWorkspaceArtifactStatus;
  sourcesPrepared?: boolean;
}

function fingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${value.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s"']+/g, "[local-path]")
    .slice(0, 800);
}

export class ResearchWorkspaceOperationCoordinator {
  private readonly projects: ResearchWorkspaceProjectController;

  constructor(
    private readonly repository: ResearchWorkspaceProjectRepository,
    options: { now?: () => Date } = {},
  ) {
    this.projects = new ResearchWorkspaceProjectController(repository, options);
  }

  async run<T>(
    params: RunResearchWorkspaceProjectOperation<T>,
  ): Promise<ResearchWorkspaceOperationResult<T>> {
    if (!params.papers.length)
      throw new Error("At least one paper is required.");
    const projectID =
      params.projectID ??
      (await this.projects.ensureQuickProject(params.papers));
    if (params.projectID && !params.sourcesPrepared) {
      await this.projects.addPapers(projectID, params.papers);
    }
    const sourceSnapshot = params.papers.map((paper) => ({
      sourceID: paper.sourceID,
      contentFingerprint: paper.contentFingerprint.value,
    }));
    const createdRun = await this.repository.createRun(projectID, {
      owner: { kind: "project", projectID },
      operation: params.operation,
      operationVersion: params.operationVersion,
      sourceSnapshot,
      status: "queued",
      progress: { phase: "queued", completed: 0, total: 1 },
    });
    let run = await this.repository.updateRun(
      projectID,
      createdRun.run.runID,
      createdRun.revision,
      (current) => ({
        ...current,
        status: params.signal?.aborted ? "cancelled" : "running",
        startedAt: current.startedAt ?? new Date().toISOString(),
        progress: {
          ...current.progress,
          phase: params.signal?.aborted ? "cancelled" : "running",
        },
      }),
    );
    if (params.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
    params.onStatus?.(`Running ${params.artifactTitle}…`);
    try {
      const result = await params.execute();
      const completedAt = new Date().toISOString();
      const artifact = await this.repository.createArtifact(projectID, {
        type: params.artifactType,
        title: params.artifactTitle,
        status: params.status ?? "complete",
        sourceIDs: params.papers.map((paper) => paper.sourceID),
        lineage: {
          inputs: params.papers.map((paper) => ({
            sourceID: paper.sourceID,
            contentFingerprint: paper.contentFingerprint.value,
            contextProjectionFingerprint: fingerprint(paper.context),
          })),
          operation: params.operation,
          operationVersion: params.operationVersion,
          promptVersion: `${params.operation}-prompt-v1`,
          parserVersion: `${params.operation}-parser-v1`,
          evidenceVerifierVersion: "paperpilot-evidence-v2",
          providerMode: params.providerMode,
          runID: run.run.runID,
        },
        payload: result,
        completedAt,
      });
      run = await this.repository.updateRun(
        projectID,
        run.run.runID,
        run.revision,
        (current) => ({
          ...current,
          status: "completed",
          artifactID: artifact.artifact.artifactID,
          completedAt,
          progress: { ...current.progress, phase: "completed", completed: 1 },
        }),
      );
      params.onStatus?.(`${params.artifactTitle} saved to the project.`);
      return { projectID, result, artifact, run };
    } catch (error) {
      const interrupted = params.signal?.aborted;
      try {
        const latest = await this.repository.getRun(projectID, run.run.runID);
        if (latest) {
          run = await this.repository.updateRun(
            projectID,
            latest.run.runID,
            latest.revision,
            (current) => ({
              ...current,
              status: interrupted ? "cancelled" : "failed",
              safeError: interrupted
                ? "Cancelled by the user."
                : safeError(error),
              completedAt: new Date().toISOString(),
              progress: {
                ...current.progress,
                phase: interrupted ? "cancelled" : "failed",
              },
            }),
          );
        }
      } catch {
        // Preserve the operation failure even if diagnostic persistence fails.
      }
      throw error;
    }
  }
}
