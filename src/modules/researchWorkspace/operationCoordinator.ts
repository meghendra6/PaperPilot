import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchWorkspaceArtifactLineage,
  ResearchWorkspaceArtifactFile,
  ResearchWorkspaceArtifactStatus,
  ResearchWorkspaceArtifactType,
  ResearchWorkspaceEngineMode,
  ResearchWorkspaceRunFile,
  ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";
import type { ResearchWorkspaceProjectRepository } from "./persistence/projectRepository";
import { researchWorkspaceArtifactPayloadFingerprint } from "./artifactFingerprint";
import { ResearchWorkspaceProjectController } from "./projectController";
import {
  claimResearchWorkspaceOwner,
  isResearchWorkspaceOwnerClaimCurrent,
  releaseResearchWorkspaceOwner,
} from "./projectRunAdmission";

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
  promptVersion?: string;
  parserVersion?: string;
  schemaVersion?: string;
  artifactType: ResearchWorkspaceArtifactType;
  artifactTitle: string;
  providerMode: ResearchWorkspaceEngineMode;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  execute: () => Promise<T>;
  status?: ResearchWorkspaceArtifactStatus;
  sourcesPrepared?: boolean;
  contextProjectionFingerprints?: ReadonlyMap<string, string>;
}

export interface RunResearchWorkspaceDerivedOperation<T> {
  projectID: string;
  sources: readonly ResearchWorkspaceSourceRecord[];
  artifactInputs: NonNullable<
    ResearchWorkspaceArtifactLineage["artifactInputs"]
  >;
  membersRevision: number;
  operation: string;
  operationVersion: string;
  promptVersion: string;
  parserVersion: string;
  schemaVersion: string;
  artifactType: ResearchWorkspaceArtifactType;
  artifactTitle: string;
  providerMode?: ResearchWorkspaceEngineMode | "local" | "unknown";
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  execute: () => T | Promise<T>;
}

export interface ResearchWorkspaceIncrementalUnit {
  unitID: string;
  sourceID: string;
}

export interface RunResearchWorkspaceIncrementalOperation<
  TPayload,
  TUnit extends ResearchWorkspaceIncrementalUnit,
  TUnitResult,
> {
  projectID: string;
  papers: readonly ResearchWorkspacePaper[];
  operation: string;
  operationVersion: string;
  promptVersion?: string;
  parserVersion?: string;
  schemaVersion?: string;
  artifactType: ResearchWorkspaceArtifactType;
  artifactTitle: string;
  providerMode: ResearchWorkspaceEngineMode;
  initialPayload: TPayload;
  units: readonly TUnit[];
  executeUnit: (unit: TUnit) => Promise<TUnitResult>;
  mergeUnit: (payload: TPayload, unit: TUnit, result: TUnitResult) => TPayload;
  reusableUnit: (payload: TPayload, unit: TUnit) => TUnitResult | undefined;
  validateReusableUnit?: (unit: TUnit, result: TUnitResult) => boolean;
  contextProjectionFingerprints?: ReadonlyMap<string, string>;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
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

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z]:\\[^\s"'<>]+|(?<![:/])\/[^\s"'<>]+/g, "[local-path]")
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

  private async assertDerivedInputsCurrent(
    params: RunResearchWorkspaceDerivedOperation<unknown>,
    sources: readonly ResearchWorkspaceSourceRecord[],
    artifactInputs: NonNullable<
      ResearchWorkspaceArtifactLineage["artifactInputs"]
    >,
  ) {
    const bundle = await this.repository.getProject(params.projectID);
    if (bundle.membersRevision !== params.membersRevision) {
      throw new Error(
        "The project source scope changed while the derived artifact was being built. Refresh and try again.",
      );
    }
    const activeMemberSourceIDs = bundle.members
      .filter((member) => member.reviewStatus !== "excluded")
      .map((member) => member.sourceID)
      .sort();
    const sourceIDs = sources.map((source) => source.sourceID).sort();
    if (JSON.stringify(activeMemberSourceIDs) !== JSON.stringify(sourceIDs)) {
      throw new Error(
        "The derived operation source snapshot does not match the current non-excluded project scope.",
      );
    }
    const memberBySourceID = new Map(
      bundle.members.map((member) => [member.sourceID, member]),
    );
    for (const source of sources) {
      const member = memberBySourceID.get(source.sourceID);
      if (!member || member.reviewStatus === "excluded") {
        throw new Error(
          `Source ${source.sourceID} is no longer included in this project.`,
        );
      }
      const current = await this.repository.getSource(source.sourceID);
      if (!current) {
        throw new Error(`Source ${source.sourceID} is no longer available.`);
      }
      const expectedFingerprint =
        source.contentFingerprint?.value ?? "source-content-unavailable";
      const currentFingerprint =
        current.source.contentFingerprint?.value ??
        "source-content-unavailable";
      if (
        currentFingerprint !== expectedFingerprint ||
        current.source.availability !== source.availability ||
        current.source.identity.libraryID !== source.identity.libraryID ||
        current.source.identity.itemKey !== source.identity.itemKey ||
        current.source.identity.attachmentKey !==
          source.identity.attachmentKey ||
        current.source.identity.standaloneAttachment !==
          source.identity.standaloneAttachment
      ) {
        throw new Error(
          `Source ${source.sourceID} changed while the derived artifact was being built. Refresh and try again.`,
        );
      }
    }
    for (const input of artifactInputs) {
      if (!bundle.project.artifactIDs.includes(input.artifactID)) {
        throw new Error(
          `Upstream artifact ${input.artifactID} is no longer part of this project.`,
        );
      }
      const current = await this.repository.getArtifact(
        params.projectID,
        input.artifactID,
      );
      if (
        !current ||
        current.artifact.status !== "complete" ||
        current.artifact.type !== input.artifactType ||
        current.artifact.version !== input.version ||
        current.artifact.updatedAt !== input.updatedAt ||
        researchWorkspaceArtifactPayloadFingerprint(
          current.artifact.payload,
        ) !== input.payloadFingerprint
      ) {
        throw new Error(
          `Upstream artifact ${input.artifactID} changed while the derived artifact was being built. Refresh and try again.`,
        );
      }
      const inputSourceIDs = [...current.artifact.sourceIDs].sort();
      if (
        inputSourceIDs.some((sourceID) => !sourceIDs.includes(sourceID)) ||
        current.artifact.lineage.inputs.some((lineageInput) => {
          const source = sources.find(
            (candidate) => candidate.sourceID === lineageInput.sourceID,
          );
          return (
            !source ||
            lineageInput.contentFingerprint !==
              (source.contentFingerprint?.value ?? "source-content-unavailable")
          );
        })
      ) {
        throw new Error(
          `Upstream artifact ${input.artifactID} is outside the current project source scope. Refresh and try again.`,
        );
      }
    }
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
    const owner = { kind: "project" as const, projectID };
    const claim = claimResearchWorkspaceOwner(owner);
    if (!claim) {
      throw new Error(
        "Another Research Workspace run is active for this project.",
      );
    }
    try {
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
        if (
          params.signal?.aborted ||
          !isResearchWorkspaceOwnerClaimCurrent(owner, claim)
        ) {
          throw new DOMException("Cancelled", "AbortError");
        }
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
              contextProjectionFingerprint:
                params.contextProjectionFingerprints?.get(paper.sourceID) ??
                fingerprint(paper.context),
            })),
            operation: params.operation,
            operationVersion: params.operationVersion,
            promptVersion:
              params.promptVersion ?? `${params.operation}-prompt-v1`,
            parserVersion:
              params.parserVersion ?? `${params.operation}-parser-v1`,
            ...(params.schemaVersion
              ? { schemaVersion: params.schemaVersion }
              : {}),
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
    } finally {
      releaseResearchWorkspaceOwner(owner, claim);
    }
  }

  async runDerived<T>(
    params: RunResearchWorkspaceDerivedOperation<T>,
  ): Promise<ResearchWorkspaceOperationResult<T>> {
    const sources = [
      ...new Map(
        params.sources.map((source) => [source.sourceID, source]),
      ).values(),
    ].sort((left, right) => left.sourceID.localeCompare(right.sourceID));
    const artifactInputs = [
      ...new Map(
        params.artifactInputs.map((input) => [input.artifactID, input]),
      ).values(),
    ].sort((left, right) => left.artifactID.localeCompare(right.artifactID));
    if (!sources.length) {
      throw new Error("At least one included project source is required.");
    }
    if (!artifactInputs.length) {
      throw new Error("At least one current upstream artifact is required.");
    }
    await this.repository.getProject(params.projectID);
    const owner = {
      kind: "project" as const,
      projectID: params.projectID,
    };
    const claim = claimResearchWorkspaceOwner(owner);
    if (!claim) {
      throw new Error(
        "Another Research Workspace run is active for this project.",
      );
    }
    try {
      await this.assertDerivedInputsCurrent(params, sources, artifactInputs);
      const sourceSnapshot = sources.map((source) => ({
        sourceID: source.sourceID,
        contentFingerprint:
          source.contentFingerprint?.value ?? "source-content-unavailable",
      }));
      const createdRun = await this.repository.createRun(params.projectID, {
        owner,
        operation: params.operation,
        operationVersion: params.operationVersion,
        sourceSnapshot,
        status: "queued",
        progress: { phase: "queued", completed: 0, total: 1 },
      });
      let run = await this.repository.updateRun(
        params.projectID,
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
      if (params.signal?.aborted) {
        throw new DOMException("Cancelled", "AbortError");
      }
      params.onStatus?.(`Building ${params.artifactTitle} locally…`);
      try {
        const result = await params.execute();
        if (
          params.signal?.aborted ||
          !isResearchWorkspaceOwnerClaimCurrent(owner, claim)
        ) {
          throw new DOMException("Cancelled", "AbortError");
        }
        await this.assertDerivedInputsCurrent(params, sources, artifactInputs);
        const completedAt = new Date().toISOString();
        const artifact = await this.repository.createArtifact(
          params.projectID,
          {
            type: params.artifactType,
            title: params.artifactTitle,
            status: "complete",
            sourceIDs: sources.map((source) => source.sourceID),
            lineage: {
              inputs: sources.map((source) => ({
                sourceID: source.sourceID,
                contentFingerprint:
                  source.contentFingerprint?.value ??
                  "source-content-unavailable",
                contextProjectionFingerprint: "artifact-derived-v1",
              })),
              artifactInputs: artifactInputs.map((input) => ({
                ...input,
              })),
              membersRevision: params.membersRevision,
              operation: params.operation,
              operationVersion: params.operationVersion,
              promptVersion: params.promptVersion,
              parserVersion: params.parserVersion,
              schemaVersion: params.schemaVersion,
              evidenceVerifierVersion: "paperpilot-evidence-v2",
              providerMode: params.providerMode ?? "local",
              runID: run.run.runID,
            },
            payload: result,
            completedAt,
          },
        );
        try {
          if (
            params.signal?.aborted ||
            !isResearchWorkspaceOwnerClaimCurrent(owner, claim)
          ) {
            throw new DOMException("Cancelled", "AbortError");
          }
          await this.assertDerivedInputsCurrent(
            params,
            sources,
            artifactInputs,
          );
        } catch (error) {
          await this.repository.markArtifactStaleAtomically({
            projectID: params.projectID,
            artifactID: artifact.artifact.artifactID,
            reason: "derived-inputs-changed-during-save",
          });
          throw error;
        }
        run = await this.repository.updateRun(
          params.projectID,
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
        return { projectID: params.projectID, result, artifact, run };
      } catch (error) {
        const interrupted = params.signal?.aborted;
        try {
          const latest = await this.repository.getRun(
            params.projectID,
            run.run.runID,
          );
          if (latest) {
            run = await this.repository.updateRun(
              params.projectID,
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
          // Preserve the derived-operation failure if diagnostics cannot save.
        }
        throw error;
      }
    } finally {
      releaseResearchWorkspaceOwner(owner, claim);
    }
  }

  async runIncremental<
    TPayload,
    TUnit extends ResearchWorkspaceIncrementalUnit,
    TUnitResult,
  >(
    params: RunResearchWorkspaceIncrementalOperation<
      TPayload,
      TUnit,
      TUnitResult
    >,
  ): Promise<ResearchWorkspaceOperationResult<TPayload>> {
    if (!params.papers.length)
      throw new Error("At least one paper is required.");
    if (!params.units.length)
      throw new Error("At least one incremental unit is required.");
    if (!params.sourcesPrepared) {
      await this.projects.addPapers(params.projectID, params.papers);
    }
    const owner = { kind: "project" as const, projectID: params.projectID };
    const claim = claimResearchWorkspaceOwner(owner);
    if (!claim) {
      throw new Error(
        "Another Research Workspace run is active for this project.",
      );
    }

    let run: ResearchWorkspaceRunFile | undefined;
    let artifact: ResearchWorkspaceArtifactFile<TPayload> | undefined;
    try {
      const sourceSnapshot = params.papers.map((paper) => ({
        sourceID: paper.sourceID,
        contentFingerprint: paper.contentFingerprint.value,
      }));
      const paperBySource = new Map(
        params.papers.map((paper) => [paper.sourceID, paper]),
      );
      const history = await this.repository.listArtifacts(params.projectID);
      const previous = history.artifacts.find(
        (candidate) =>
          candidate.type === params.artifactType &&
          (candidate.status === "partial" || candidate.status === "stale") &&
          candidate.lineage.operation === params.operation &&
          candidate.lineage.operationVersion === params.operationVersion &&
          candidate.lineage.parserVersion ===
            (params.parserVersion ?? `${params.operation}-parser-v1`) &&
          candidate.sourceIDs.length === params.papers.length &&
          params.papers.every((paper) =>
            candidate.sourceIDs.includes(paper.sourceID),
          ),
      );
      let payload = clone(params.initialPayload);
      const completedUnits: string[] = [];
      if (previous?.checkpoint) {
        for (const unit of params.units) {
          if (!previous.checkpoint.completedUnits.includes(unit.unitID))
            continue;
          const currentPaper = paperBySource.get(unit.sourceID);
          const previousInput = previous.lineage.inputs.find(
            (input) => input.sourceID === unit.sourceID,
          );
          if (
            !currentPaper ||
            previousInput?.contentFingerprint !==
              currentPaper.contentFingerprint.value
          ) {
            continue;
          }
          const reusable = params.reusableUnit(
            previous.payload as TPayload,
            unit,
          );
          if (
            reusable === undefined ||
            (params.validateReusableUnit &&
              !params.validateReusableUnit(unit, reusable))
          ) {
            continue;
          }
          payload = params.mergeUnit(payload, unit, clone(reusable));
          completedUnits.push(unit.unitID);
        }
      }
      const failedUnits: Array<{ unitID: string; message: string }> = [];
      let pendingUnits = params.units
        .map((unit) => unit.unitID)
        .filter((unitID) => !completedUnits.includes(unitID));

      const createdRun = await this.repository.createRun(params.projectID, {
        owner,
        operation: params.operation,
        operationVersion: params.operationVersion,
        sourceSnapshot,
        status: "queued",
        progress: {
          phase: "queued",
          completed: completedUnits.length,
          total: params.units.length,
        },
      });
      run = await this.repository.updateRun(
        params.projectID,
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
      const checkpointAt = new Date().toISOString();
      artifact = await this.repository.createArtifact(params.projectID, {
        type: params.artifactType,
        title: params.artifactTitle,
        status: "partial",
        sourceIDs: params.papers.map((paper) => paper.sourceID),
        lineage: {
          inputs: params.papers.map((paper) => ({
            sourceID: paper.sourceID,
            contentFingerprint: paper.contentFingerprint.value,
            contextProjectionFingerprint:
              params.contextProjectionFingerprints?.get(paper.sourceID) ??
              fingerprint(paper.context),
          })),
          operation: params.operation,
          operationVersion: params.operationVersion,
          promptVersion:
            params.promptVersion ?? `${params.operation}-prompt-v1`,
          parserVersion:
            params.parserVersion ?? `${params.operation}-parser-v1`,
          ...(params.schemaVersion
            ? { schemaVersion: params.schemaVersion }
            : {}),
          evidenceVerifierVersion: "paperpilot-evidence-v2",
          providerMode: params.providerMode,
          runID: run.run.runID,
        },
        payload,
        checkpoint: {
          completedUnits: [...completedUnits],
          failedUnits: [],
          pendingUnits: [...pendingUnits],
          lastCheckpointAt: checkpointAt,
        },
      });
      run = await this.repository.updateRun(
        params.projectID,
        run.run.runID,
        run.revision,
        (current) => ({
          ...current,
          artifactID: artifact!.artifact.artifactID,
        }),
      );

      for (const unit of params.units) {
        if (!pendingUnits.includes(unit.unitID)) continue;
        if (
          params.signal?.aborted ||
          !isResearchWorkspaceOwnerClaimCurrent(owner, claim)
        ) {
          break;
        }
        params.onStatus?.(
          `${params.artifactTitle}: ${completedUnits.length}/${params.units.length} · ${unit.unitID}`,
        );
        run = await this.repository.updateRun(
          params.projectID,
          run.run.runID,
          run.revision,
          (current) => ({
            ...current,
            progress: {
              ...current.progress,
              phase: "running",
              currentUnit: unit.unitID,
            },
          }),
        );
        try {
          const result = await params.executeUnit(unit);
          if (
            params.signal?.aborted ||
            !isResearchWorkspaceOwnerClaimCurrent(owner, claim)
          ) {
            break;
          }
          payload = params.mergeUnit(payload, unit, result);
          completedUnits.push(unit.unitID);
          pendingUnits = pendingUnits.filter(
            (unitID) => unitID !== unit.unitID,
          );
          const currentArtifact = await this.repository.getArtifact(
            params.projectID,
            artifact.artifact.artifactID,
          );
          if (!currentArtifact)
            throw new Error(
              "Incremental artifact disappeared during execution.",
            );
          artifact = await this.repository.updateArtifact<TPayload>(
            params.projectID,
            currentArtifact.artifact.artifactID,
            currentArtifact.revision,
            (current) => ({
              ...current,
              payload: clone(payload),
              checkpoint: {
                completedUnits: [...completedUnits],
                failedUnits: [...failedUnits],
                pendingUnits: [...pendingUnits],
                lastCheckpointAt: new Date().toISOString(),
              },
            }),
          );
          run = await this.repository.updateRun(
            params.projectID,
            run.run.runID,
            run.revision,
            (current) => ({
              ...current,
              progress: {
                ...current.progress,
                completed: completedUnits.length,
                currentUnit: undefined,
              },
            }),
          );
        } catch (error) {
          if (params.signal?.aborted) break;
          failedUnits.push({ unitID: unit.unitID, message: safeError(error) });
          pendingUnits = pendingUnits.filter(
            (unitID) => unitID !== unit.unitID,
          );
          const currentArtifact = await this.repository.getArtifact(
            params.projectID,
            artifact.artifact.artifactID,
          );
          if (!currentArtifact)
            throw new Error(
              "Incremental artifact disappeared during execution.",
            );
          artifact = await this.repository.updateArtifact<TPayload>(
            params.projectID,
            currentArtifact.artifact.artifactID,
            currentArtifact.revision,
            (current) => ({
              ...current,
              checkpoint: {
                completedUnits: [...completedUnits],
                failedUnits: [...failedUnits],
                pendingUnits: [...pendingUnits],
                lastCheckpointAt: new Date().toISOString(),
              },
            }),
          );
          run = await this.repository.updateRun(
            params.projectID,
            run.run.runID,
            run.revision,
            (current) => ({
              ...current,
              progress: {
                ...current.progress,
                completed: completedUnits.length,
                currentUnit: undefined,
              },
            }),
          );
        }
      }

      if (params.signal?.aborted) {
        const latest = await this.repository.getRun(
          params.projectID,
          run.run.runID,
        );
        if (latest) {
          run = await this.repository.updateRun(
            params.projectID,
            latest.run.runID,
            latest.revision,
            (current) => ({
              ...current,
              status: "cancelled",
              safeError: "Cancelled by the user after saving completed units.",
              completedAt: new Date().toISOString(),
              progress: { ...current.progress, phase: "cancelled" },
            }),
          );
        }
        throw new DOMException("Cancelled", "AbortError");
      }

      const completedAt = new Date().toISOString();
      const status = failedUnits.length ? "partial" : "complete";
      const latestArtifact = await this.repository.getArtifact(
        params.projectID,
        artifact.artifact.artifactID,
      );
      if (!latestArtifact)
        throw new Error("Incremental artifact disappeared before completion.");
      artifact = await this.repository.updateArtifact<TPayload>(
        params.projectID,
        latestArtifact.artifact.artifactID,
        latestArtifact.revision,
        (current) => ({
          ...current,
          status,
          ...(status === "complete" ? { completedAt } : {}),
          payload: clone(payload),
          checkpoint: {
            completedUnits: [...completedUnits],
            failedUnits: [...failedUnits],
            pendingUnits: [...pendingUnits],
            lastCheckpointAt: completedAt,
          },
        }),
      );
      const latestRun = await this.repository.getRun(
        params.projectID,
        run.run.runID,
      );
      if (!latestRun) throw new Error("Incremental run disappeared.");
      run = await this.repository.updateRun(
        params.projectID,
        latestRun.run.runID,
        latestRun.revision,
        (current) => ({
          ...current,
          status: failedUnits.length ? "partial" : "completed",
          completedAt,
          artifactID: artifact!.artifact.artifactID,
          safeError: failedUnits.length
            ? `${failedUnits.length} unit(s) failed; completed units were saved.`
            : undefined,
          progress: {
            ...current.progress,
            phase: failedUnits.length ? "partial" : "completed",
            completed: completedUnits.length,
            currentUnit: undefined,
          },
        }),
      );
      params.onStatus?.(
        failedUnits.length
          ? `${params.artifactTitle} saved with ${failedUnits.length} failed unit(s). Run again to resume.`
          : `${params.artifactTitle} saved to the project.`,
      );
      return { projectID: params.projectID, result: payload, artifact, run };
    } catch (error) {
      if (run && !params.signal?.aborted) {
        try {
          const latest = await this.repository.getRun(
            params.projectID,
            run.run.runID,
          );
          if (
            latest &&
            !["completed", "partial", "cancelled"].includes(latest.run.status)
          ) {
            run = await this.repository.updateRun(
              params.projectID,
              latest.run.runID,
              latest.revision,
              (current) => ({
                ...current,
                status: "failed",
                safeError: safeError(error),
                completedAt: new Date().toISOString(),
                progress: { ...current.progress, phase: "failed" },
              }),
            );
          }
        } catch {
          // Preserve the primary error.
        }
      }
      throw error;
    } finally {
      releaseResearchWorkspaceOwner(owner, claim);
    }
  }
}
