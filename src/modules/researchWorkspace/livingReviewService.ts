import {
  ResearchWorkspaceRevisionConflictError,
  type ResearchWorkspaceChangeInboxFile,
  type ResearchWorkspaceLivingReviewSnapshot,
  type ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";
import { ResearchWorkspaceProjectRepository } from "./persistence/projectRepository";
import {
  createResearchWorkspaceChangeInbox,
  reconcileResearchWorkspaceLivingReview,
  resolveResearchWorkspaceLivingReviewChange,
} from "./livingReview";
import {
  createZoteroLivingReviewObserver,
  type ZoteroLivingReviewObserver,
} from "./livingReviewObservation";

export interface ResearchWorkspaceLivingReviewServiceOptions {
  observer?: ZoteroLivingReviewObserver;
  now?: () => Date;
  maxRetries?: number;
  log?: (message: string, error: unknown) => void;
}

export interface ResolveResearchWorkspaceChangeParams {
  projectID: string;
  changeID: string;
  action: "reviewed" | "dismissed";
  submissionID: string;
  expectedRevision: number;
}

function unavailableSnapshot(
  sourceID: string,
  observedAt: string,
): ResearchWorkspaceLivingReviewSnapshot {
  return { sourceID, observedAt, availability: "detached" };
}

function sameSourceObservation(
  source: ResearchWorkspaceSourceRecord,
  observation: ResearchWorkspaceLivingReviewSnapshot,
) {
  const observedFingerprint = observation.contentFingerprint;
  const currentFingerprint = source.contentFingerprint?.value;
  return {
    contentChanged: Boolean(
      observation.availability === "ready" &&
        observedFingerprint &&
        currentFingerprint !== observedFingerprint,
    ),
    availabilityChanged: source.availability !== observation.availability,
  };
}

function refreshCandidate(
  source: ResearchWorkspaceSourceRecord,
  observation: ResearchWorkspaceLivingReviewSnapshot,
  resolvedAt: string,
) {
  const { contentChanged, availabilityChanged } = sameSourceObservation(
    source,
    observation,
  );
  if (!contentChanged && !availabilityChanged) return undefined;
  const extractionNotes = contentChanged
    ? [
        ...new Set([
          ...source.extractionNotes,
          "Living Review detected a changed local PDF; re-extraction is required before analysis.",
        ]),
      ]
    : source.extractionNotes;
  return {
    ...source,
    availability: observation.availability,
    lastResolvedAt: resolvedAt,
    ...(contentChanged
      ? {
          contentFingerprint: {
            algorithm: "zotero-version-mtime-size-v1" as const,
            value: observation.contentFingerprint!,
          },
          extractionFingerprint: undefined,
          lastExtractedAt: undefined,
          extractionQuality: "unavailable" as const,
          extractionNotes,
        }
      : {}),
  } satisfies ResearchWorkspaceSourceRecord;
}

export class ResearchWorkspaceLivingReviewService {
  private readonly observer: ZoteroLivingReviewObserver;
  private readonly now: () => Date;
  private readonly maxRetries: number;
  private readonly log?: (message: string, error: unknown) => void;
  private scanQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: ResearchWorkspaceProjectRepository,
    options: ResearchWorkspaceLivingReviewServiceOptions = {},
  ) {
    this.observer = options.observer ?? createZoteroLivingReviewObserver();
    this.now = options.now ?? (() => new Date());
    this.maxRetries = Math.max(1, Math.min(10, options.maxRetries ?? 3));
    this.log = options.log;
  }

  load(projectID: string) {
    return this.repository.getChangeInbox(projectID);
  }

  private async exclusiveScan<T>(action: () => Promise<T>) {
    const previous = this.scanQueue;
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.scanQueue = previous.then(() => current);
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async invalidateSharedSource(params: {
    sourceID: string;
    comparisonFingerprint: string;
    reason: string;
  }) {
    const projectIDs = await this.repository.listProjectIDsForSource(
      params.sourceID,
      { includeArchived: true },
    );
    for (const projectID of projectIDs) {
      await this.repository.markArtifactsStaleForSource({
        projectID,
        sourceID: params.sourceID,
        contentFingerprint: params.comparisonFingerprint,
        reason: params.reason,
      });
    }
  }

  private invalidationFor(observation: ResearchWorkspaceLivingReviewSnapshot) {
    if (
      observation.availability === "ready" &&
      observation.contentFingerprint
    ) {
      return {
        sourceID: observation.sourceID,
        comparisonFingerprint: observation.contentFingerprint!,
        reason: `source-content-changed:${observation.sourceID}`,
      };
    }
    if (observation.availability !== "ready") {
      return {
        sourceID: observation.sourceID,
        comparisonFingerprint: `living-review-unavailable:${observation.availability}:${observation.sourceID}`,
        reason: `source-unavailable:${observation.sourceID}`,
      };
    }
    return undefined;
  }

  private async refreshPersistedSource(
    sourceID: string,
    observation: ResearchWorkspaceLivingReviewSnapshot,
    resolvedAt: string,
    observedRevision: number | undefined,
  ) {
    if (observedRevision === undefined) {
      const current = await this.repository.getSource(sourceID);
      if (current) return false;
      const invalidation = this.invalidationFor(observation);
      if (invalidation) await this.invalidateSharedSource(invalidation);
      return true;
    }

    try {
      await this.repository.mutateSourceAtRevision(
        sourceID,
        observedRevision,
        (source) => refreshCandidate(source, observation, resolvedAt),
      );
    } catch (error) {
      if (
        error instanceof ResearchWorkspaceRevisionConflictError ||
        (error instanceof Error &&
          error.message ===
            `Research Workspace file is missing: ${this.repository.getSourcePath(
              sourceID,
            )}`)
      ) {
        return false;
      }
      throw error;
    }
    const invalidation = this.invalidationFor(observation);
    if (invalidation) await this.invalidateSharedSource(invalidation);
    return true;
  }

  private async observeCurrentSource(sourceID: string, checkedAt: string) {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const sourceFile = await this.repository.getSource(sourceID);
      const observedRevision = sourceFile?.revision;
      let observation: ResearchWorkspaceLivingReviewSnapshot;
      if (!sourceFile) {
        observation = unavailableSnapshot(sourceID, checkedAt);
      } else {
        try {
          observation = await this.observer(sourceFile.source, checkedAt);
        } catch (error) {
          this.log?.(
            `Living Review could not observe source ${sourceID}.`,
            error,
          );
          observation = {
            sourceID,
            observedAt: checkedAt,
            availability: "unreadable",
          };
        }
      }
      if (observation.sourceID !== sourceID) {
        throw new Error(
          `Living Review observation crossed source identity for ${sourceID}.`,
        );
      }
      const accepted = await this.refreshPersistedSource(
        sourceID,
        observation,
        checkedAt,
        observedRevision,
      );
      if (accepted) return observation;
    }
    throw new Error(
      `Source ${sourceID} changed repeatedly while Living Review was observing it. Try again.`,
    );
  }

  private async persistObservations(
    projectID: string,
    observations: readonly ResearchWorkspaceLivingReviewSnapshot[],
    checkedAt: string,
  ) {
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const current = await this.repository.getChangeInbox(projectID);
      const effectiveCheckedAt =
        current.lastCheckedAt && current.lastCheckedAt > checkedAt
          ? current.lastCheckedAt
          : checkedAt;
      const next = reconcileResearchWorkspaceLivingReview(
        current,
        observations,
        effectiveCheckedAt,
      );
      try {
        return await this.repository.updateChangeInbox(
          projectID,
          current.revision,
          () => next,
        );
      } catch (error) {
        if (!(error instanceof ResearchWorkspaceRevisionConflictError)) {
          throw error;
        }
      }
    }
    throw new Error(
      `Project ${projectID} changed repeatedly while Living Review was saving. Try again.`,
    );
  }

  private async checkProjectOnce(projectID: string) {
    const checkedAt = this.now().toISOString();
    const bundle = await this.repository.getProject(projectID);
    const observations: ResearchWorkspaceLivingReviewSnapshot[] = [];
    for (const member of bundle.members) {
      observations.push(
        await this.observeCurrentSource(member.sourceID, checkedAt),
      );
    }
    return this.persistObservations(projectID, observations, checkedAt);
  }

  checkProject(projectID: string) {
    return this.exclusiveScan(() => this.checkProjectOnce(projectID));
  }

  async resolveChange(params: ResolveResearchWorkspaceChangeParams) {
    return this.repository.updateChangeInbox(
      params.projectID,
      params.expectedRevision,
      (inbox) =>
        resolveResearchWorkspaceLivingReviewChange(inbox, {
          changeID: params.changeID,
          action: params.action,
          submissionID: params.submissionID,
          actedAt: this.now().toISOString(),
        }),
    );
  }

  async refreshSource(projectID: string, sourceID: string) {
    const bundle = await this.repository.getProject(projectID);
    if (!bundle.members.some((member) => member.sourceID === sourceID)) {
      throw new Error(`Source ${sourceID} is not a member of this project.`);
    }
    return this.checkProject(projectID);
  }

  async checkAllActiveProjects() {
    const projects = await this.repository.listProjects();
    const checkedProjectIDs: string[] = [];
    const failures: Array<{ projectID: string; message: string }> = [];
    for (const project of projects) {
      try {
        await this.checkProject(project.projectID);
        checkedProjectIDs.push(project.projectID);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ projectID: project.projectID, message });
        this.log?.(
          `Living Review failed for project ${project.projectID}.`,
          error,
        );
      }
    }
    return { checkedProjectIDs, failures };
  }
}

export function createEmptyResearchWorkspaceLivingReviewInbox(
  projectID: string,
): ResearchWorkspaceChangeInboxFile {
  return createResearchWorkspaceChangeInbox(projectID);
}
