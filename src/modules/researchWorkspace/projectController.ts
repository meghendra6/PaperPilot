import type { ResearchWorkspacePaper } from "./paperSource";
import {
  ResearchWorkspaceNotFoundError,
  ResearchWorkspaceRevisionConflictError,
  type ResearchProject,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceCatalogEntry,
  type ResearchWorkspaceProjectMember,
  type ResearchWorkspaceReviewStatus,
  type ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";
import {
  buildResearchWorkspaceScreeningLog,
  createScreeningDecisionEvent,
  currentScreeningEvent,
  reconcileScreeningCriteria,
  screeningDecisionMatchesInput,
  screeningReviewStatus,
  type RecordResearchWorkspaceScreeningDecisionInput,
} from "./screeningLog";
import {
  ResearchWorkspaceProjectRepository,
  researchWorkspaceSourcePathID,
  type CreateResearchWorkspaceProjectInput,
} from "./persistence/projectRepository";

export interface ResearchWorkspaceProjectDetails {
  project: ResearchProject;
  projectRevision: number;
  members: ResearchWorkspaceProjectMember[];
  membersRevision: number;
  sources: ResearchWorkspaceSourceRecord[];
  artifacts: ResearchWorkspaceArtifact[];
  warnings: string[];
}

export interface ResearchWorkspaceProjectHome {
  projects: ResearchWorkspaceCatalogEntry[];
  archivedProjects: ResearchWorkspaceCatalogEntry[];
  dueMasteryReviews: number;
  staleArtifacts: number;
}

function timestamp(now: () => Date) {
  return now().toISOString();
}

export function researchWorkspaceSourceRecordFromPaper(
  paper: ResearchWorkspacePaper,
  now = new Date(),
): ResearchWorkspaceSourceRecord {
  const extractedAt = now.toISOString();
  return {
    sourceID: paper.sourceID,
    identity: {
      libraryID: paper.libraryID,
      itemKey: paper.itemKey,
      attachmentKey: paper.attachmentKey,
      standaloneAttachment: paper.itemID === paper.attachmentID,
    },
    title: paper.title,
    ...(paper.creators?.length ? { creators: [...paper.creators] } : {}),
    ...(paper.year ? { year: paper.year } : {}),
    ...(paper.doi ? { doi: paper.doi } : {}),
    runtimeItemID: paper.itemID,
    runtimeAttachmentID: paper.attachmentID,
    contentFingerprint: { ...paper.contentFingerprint },
    extractionFingerprint: {
      contentFingerprint: { ...paper.contentFingerprint },
      extractor:
        paper.extractionQuality === "structured"
          ? "opendataloader-pdf"
          : "zotero-attachment-text",
      extractorVersion:
        paper.extractionQuality === "structured"
          ? "opendataloader-pdf@2.2.0"
          : "zotero-attachment-text@1",
      extractionOptionsVersion: "reading-order-xycut-v1",
    },
    extractionQuality: paper.extractionQuality,
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: extractedAt,
    lastExtractedAt: extractedAt,
  };
}

function quickProjectID(papers: readonly ResearchWorkspacePaper[]) {
  const scope = [...new Set(papers.map((paper) => paper.sourceID))]
    .sort()
    .join("\n");
  return `quick-${researchWorkspaceSourcePathID(scope)}`;
}

export class ResearchWorkspaceProjectController {
  private readonly now: () => Date;
  private readonly screeningIDFactory: (prefix: string) => string;

  constructor(
    private readonly repository: ResearchWorkspaceProjectRepository,
    options: {
      now?: () => Date;
      screeningIDFactory?: (prefix: string) => string;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.screeningIDFactory =
      options.screeningIDFactory ??
      ((prefix) =>
        `${prefix}-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`);
  }

  async home(): Promise<ResearchWorkspaceProjectHome> {
    const entries = await this.repository.listProjects({
      includeArchived: true,
    });
    const projects = entries.filter((entry) => !entry.archivedAt);
    const archivedProjects = entries.filter((entry) => entry.archivedAt);
    let dueMasteryReviews = 0;
    for (const entry of projects) {
      const artifacts = await this.repository.listArtifacts(entry.projectID);
      dueMasteryReviews += artifacts.artifacts.filter((artifact) => {
        if (artifact.type !== "paper-mastery") return false;
        const payload = artifact.payload as {
          session?: { nextReviewAt?: string; phase?: string };
          nextReviewAt?: string;
          phase?: string;
        };
        const session = payload.session ?? payload;
        return Boolean(
          session.phase !== "completed" &&
            session.nextReviewAt &&
            session.nextReviewAt <= timestamp(this.now),
        );
      }).length;
    }
    return {
      projects,
      archivedProjects,
      dueMasteryReviews,
      staleArtifacts: projects.reduce(
        (total, entry) => total + entry.staleArtifactCount,
        0,
      ),
    };
  }

  async createProject(
    input: CreateResearchWorkspaceProjectInput,
    papers: readonly ResearchWorkspacePaper[] = [],
  ) {
    const created = await this.repository.createProject(input);
    if (papers.length) await this.addPapers(created.project.projectID, papers);
    return this.details(created.project.projectID);
  }

  async ensureQuickProject(papers: readonly ResearchWorkspacePaper[]) {
    if (!papers.length) throw new Error("At least one paper is required.");
    const projectID = quickProjectID(papers);
    try {
      await this.repository.getProject(projectID);
    } catch (error) {
      if (!(error instanceof ResearchWorkspaceNotFoundError)) throw error;
      const title =
        papers.length === 1
          ? `Quick analysis · ${papers[0].title}`
          : `Selection · ${papers.length} papers`;
      await this.repository.createProject({ projectID, name: title });
    }
    await this.addPapers(projectID, papers);
    return projectID;
  }

  async addPapers(
    projectID: string,
    papers: readonly ResearchWorkspacePaper[],
  ) {
    const unique = [
      ...new Map(papers.map((paper) => [paper.sourceID, paper])).values(),
    ];
    for (const paper of unique) {
      const current = await this.repository.getSource(paper.sourceID);
      const contentChanged = Boolean(
        current?.source.contentFingerprint?.value &&
          current.source.contentFingerprint.value !==
            paper.contentFingerprint.value,
      );
      const invalidateAffectedProjects = async () => {
        const projectIDs = await this.repository.listProjectIDsForSource(
          paper.sourceID,
          { includeArchived: true },
        );
        for (const affectedProjectID of projectIDs) {
          await this.repository.markArtifactsStaleForSource({
            projectID: affectedProjectID,
            sourceID: paper.sourceID,
            contentFingerprint: paper.contentFingerprint.value,
          });
        }
      };
      if (contentChanged) await invalidateAffectedProjects();
      await this.repository.putSource(
        researchWorkspaceSourceRecordFromPaper(paper, this.now()),
        current?.revision,
      );
      // A derived artifact can be admitted while the source write is in flight.
      // Re-scan project membership after the write so that result is also made
      // stale against the newly persisted fingerprint.
      if (contentChanged) await invalidateAffectedProjects();
    }
    if (unique.length) {
      const bundle = await this.repository.getProject(projectID);
      const existingSourceIDs = new Set(
        bundle.members.map((member) => member.sourceID),
      );
      const additions = unique
        .filter((paper) => !existingSourceIDs.has(paper.sourceID))
        .map((paper) => ({
          sourceID: paper.sourceID,
          role: "candidate" as const,
        }));
      if (additions.length) {
        const membersFile = await this.repository.addMembers(
          projectID,
          bundle.membersRevision,
          additions,
        );
        await this.repository.markArtifactsStaleForMembersRevision({
          projectID,
          membersRevision: membersFile.revision,
          reason: "project-source-added",
        });
      }
    }
    return this.details(projectID);
  }

  async details(projectID: string): Promise<ResearchWorkspaceProjectDetails> {
    const [bundle, artifactList] = await Promise.all([
      this.repository.getProject(projectID),
      this.repository.listArtifacts(projectID),
    ]);
    const sources: ResearchWorkspaceSourceRecord[] = [];
    const warnings = [...artifactList.warnings];
    for (const member of bundle.members) {
      try {
        const file = await this.repository.getSource(member.sourceID);
        if (file) sources.push(file.source);
        else warnings.push(`Source ${member.sourceID} is missing.`);
      } catch (error) {
        warnings.push(
          `Source ${member.sourceID} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return {
      ...bundle,
      sources,
      artifacts: artifactList.artifacts,
      warnings,
    };
  }

  async updateProject(
    projectID: string,
    patch: Pick<
      Partial<ResearchProject>,
      | "name"
      | "description"
      | "researchQuestion"
      | "scope"
      | "defaultEngineMode"
    >,
  ) {
    const bundle = await this.repository.getProject(projectID);
    await this.repository.updateProject(
      projectID,
      bundle.projectRevision,
      (project) => ({ ...project, ...patch }),
    );
    return this.details(projectID);
  }

  async updateMember(params: {
    projectID: string;
    sourceID: string;
    reviewStatus: ResearchWorkspaceReviewStatus;
    exclusionReason?: string;
    userNote?: string;
  }) {
    const bundle = await this.repository.getProject(params.projectID);
    const previous = bundle.members.find(
      (member) => member.sourceID === params.sourceID,
    );
    const membersFile = await this.repository.updateMembers(
      params.projectID,
      bundle.membersRevision,
      (members) =>
        members.map((member) =>
          member.sourceID === params.sourceID
            ? {
                ...member,
                reviewStatus: params.reviewStatus,
                ...(params.exclusionReason?.trim()
                  ? { exclusionReason: params.exclusionReason.trim() }
                  : { exclusionReason: undefined }),
                ...(params.userNote?.trim()
                  ? { userNote: params.userNote.trim() }
                  : {}),
                updatedAt: timestamp(this.now),
              }
            : member,
        ),
    );
    if (previous) {
      await this.repository.markArtifactsStaleForMembersRevision({
        projectID: params.projectID,
        membersRevision: membersFile.revision,
        reason:
          previous.reviewStatus !== params.reviewStatus
            ? "project-review-scope-changed"
            : "project-member-record-changed",
      });
    }
    return this.details(params.projectID);
  }

  async updateScreeningProtocol(params: {
    projectID: string;
    expectedProjectRevision: number;
    inclusionCriteria: string[];
    exclusionCriteria: string[];
  }) {
    const bundle = await this.repository.getProject(params.projectID);
    if (bundle.projectRevision !== params.expectedProjectRevision) {
      throw new ResearchWorkspaceRevisionConflictError(
        `project-${params.projectID}/project.json`,
        params.expectedProjectRevision,
        bundle.projectRevision,
      );
    }
    const acceptedAt = timestamp(this.now);
    await this.repository.updateProject(
      params.projectID,
      params.expectedProjectRevision,
      (project) => ({
        ...project,
        scope: {
          ...(project.scope?.pico ? { pico: { ...project.scope.pico } } : {}),
          inclusionCriteria: reconcileScreeningCriteria({
            existing: project.scope?.inclusionCriteria ?? [],
            lines: params.inclusionCriteria,
            kind: "inclusion",
            acceptedAt,
          }),
          exclusionCriteria: reconcileScreeningCriteria({
            existing: project.scope?.exclusionCriteria ?? [],
            lines: params.exclusionCriteria,
            kind: "exclusion",
            acceptedAt,
          }),
        },
      }),
    );
    return this.details(params.projectID);
  }

  async recordScreeningDecision(
    input: RecordResearchWorkspaceScreeningDecisionInput,
  ) {
    const bundle = await this.repository.getProject(input.projectID);
    const duplicate = bundle.members
      .flatMap((member) => member.screeningEvents ?? [])
      .find((event) => event.submissionID === input.submissionID);
    if (duplicate) {
      if (!screeningDecisionMatchesInput(duplicate, input)) {
        throw new Error(
          "Screening decision idempotency conflict: this submission ID was already used for different input.",
        );
      }
      return this.details(input.projectID);
    }
    if (bundle.projectRevision !== input.expectedProjectRevision) {
      throw new ResearchWorkspaceRevisionConflictError(
        `project-${input.projectID}/project.json`,
        input.expectedProjectRevision,
        bundle.projectRevision,
      );
    }
    const member = bundle.members.find(
      (candidate) => candidate.sourceID === input.sourceID,
    );
    if (!member) {
      throw new ResearchWorkspaceNotFoundError(
        "Project member",
        input.sourceID,
      );
    }
    const sourceFile = await this.repository.getSource(input.sourceID);
    if (!sourceFile) {
      throw new ResearchWorkspaceNotFoundError("Source", input.sourceID);
    }
    if (
      input.stage === "full-text" &&
      sourceFile.source.availability !== "ready"
    ) {
      throw new Error(
        "Full-text screening requires an available local PDF; use abstract screening or restore the source.",
      );
    }
    const criteria = new Set(
      [
        ...(bundle.project.scope?.inclusionCriteria ?? []),
        ...(bundle.project.scope?.exclusionCriteria ?? []),
      ]
        .filter((criterion) => criterion.enabled)
        .map((criterion) => criterion.criterionID),
    );
    for (const criterionID of input.criterionIDs ?? []) {
      if (!criteria.has(criterionID)) {
        throw new Error(
          `Unknown or disabled screening criterion ${criterionID}.`,
        );
      }
    }
    const event = createScreeningDecisionEvent({
      input,
      source: sourceFile.source,
      project: bundle.project,
      previous: currentScreeningEvent(member),
      eventID: this.screeningIDFactory("screening-event"),
      decidedAt: timestamp(this.now),
    });
    const membersFile = await this.repository.updateMembers(
      input.projectID,
      input.expectedMembersRevision,
      (members) =>
        members.map((candidate) =>
          candidate.sourceID === input.sourceID
            ? {
                ...candidate,
                reviewStatus: screeningReviewStatus(input.decision),
                ...(input.decision === "exclude"
                  ? { exclusionReason: event.reason!.text }
                  : { exclusionReason: undefined }),
                screeningEvents: [...(candidate.screeningEvents ?? []), event],
                updatedAt: event.decidedAt,
              }
            : candidate,
        ),
    );
    await this.repository.markArtifactsStaleForMembersRevision({
      projectID: input.projectID,
      membersRevision: membersFile.revision,
      reason:
        member.reviewStatus !== screeningReviewStatus(input.decision)
          ? "screening-decision-changed-project-scope"
          : "project-member-record-changed",
    });
    return this.details(input.projectID);
  }

  async screeningLog(projectID: string) {
    const details = await this.details(projectID);
    return buildResearchWorkspaceScreeningLog({
      project: details.project,
      members: details.members,
      sources: details.sources,
      generatedAt: timestamp(this.now),
    });
  }

  async archiveProject(projectID: string) {
    const bundle = await this.repository.getProject(projectID);
    await this.repository.archiveProject(projectID, bundle.projectRevision);
    return this.details(projectID);
  }

  deleteProject(projectID: string) {
    return this.repository.deleteProject(projectID);
  }

  exportProject(projectID: string) {
    return this.repository.exportProject(projectID);
  }
}
