import { researchWorkspaceArtifactPayloadFingerprint } from "./artifactFingerprint";
import type { ResearchWorkspacePaper } from "./paperSource";
import {
  isResearchWorkspaceMemberExcluded,
  memberReadingProgress,
  memberUnderstanding,
} from "./memberState";
import {
  OPEN_DATA_LOADER_EXTRACTOR_VERSION,
  ZOTERO_ATTACHMENT_TEXT_EXTRACTOR_VERSION,
} from "../tools/paperWorkspaceContent";
import {
  ResearchWorkspaceNotFoundError,
  ResearchWorkspaceRevisionConflictError,
  type ResearchProject,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceCatalogEntry,
  type ResearchWorkspaceProjectMember,
  type ResearchWorkspaceReviewStatus,
  type ResearchWorkspaceSourceRecord,
  type ResearchWorkspaceCandidate,
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
import {
  instantiateResearchWorkspaceProjectTemplate,
  updateResearchWorkspaceProjectTemplateSettings,
  type ResearchWorkspaceProjectTemplatePreview,
} from "./projectTemplates";

export interface ResearchWorkspaceProjectDetails {
  project: ResearchProject;
  projectRevision: number;
  members: ResearchWorkspaceProjectMember[];
  membersRevision: number;
  sources: ResearchWorkspaceSourceRecord[];
  artifacts: ResearchWorkspaceArtifact[];
  warnings: string[];
  candidates?: ResearchWorkspaceCandidate[];
  candidatesRevision?: number;
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
          ? OPEN_DATA_LOADER_EXTRACTOR_VERSION
          : ZOTERO_ATTACHMENT_TEXT_EXTRACTOR_VERSION,
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
  private readonly validateSource?: (
    paper: ResearchWorkspacePaper,
  ) => Promise<void>;
  private readonly screeningIDFactory: (prefix: string) => string;
  private readonly addPaperQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: ResearchWorkspaceProjectRepository,
    options: {
      now?: () => Date;
      validateSource?: (paper: ResearchWorkspacePaper) => Promise<void>;
      screeningIDFactory?: (prefix: string) => string;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.validateSource = options.validateSource;
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
    const dueMasteryReviews = projects.reduce(
      (total, entry) => total + (entry.dueMasteryReviewCount ?? 0),
      0,
    );
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

  async createProjectFromTemplate(
    preview: ResearchWorkspaceProjectTemplatePreview,
    papers: readonly ResearchWorkspacePaper[] = [],
  ) {
    const instantiated = instantiateResearchWorkspaceProjectTemplate({
      preview,
      appliedAt: timestamp(this.now),
    });
    return this.createProject(
      {
        name: instantiated.projectName,
        description: instantiated.description,
        researchQuestion: instantiated.researchQuestion,
        templateSnapshot: instantiated.templateSnapshot,
        templateAssumptions: instantiated.templateAssumptions,
        capabilityPresetIDs: instantiated.capabilityPresetIDs,
      },
      papers,
    );
  }

  async updateTemplateSettings(params: {
    projectID: string;
    expectedProjectRevision: number;
    assumptions: NonNullable<ResearchProject["templateAssumptions"]>;
    capabilityPresetIDs: string[];
  }) {
    await this.repository.updateProject(
      params.projectID,
      params.expectedProjectRevision,
      (project) =>
        updateResearchWorkspaceProjectTemplateSettings(project, {
          assumptions: params.assumptions,
          capabilityPresetIDs: params.capabilityPresetIDs,
        }),
    );
    const bundle = await this.repository.getProject(params.projectID);
    await this.repository.markArtifactsStaleForMembersRevision({
      projectID: params.projectID,
      membersRevision: bundle.membersRevision,
      reason: "project-assumptions-changed",
    });
    return this.details(params.projectID);
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
    const previous = this.addPaperQueues.get(projectID) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.addPaperQueues.set(projectID, queued);
    await previous;
    try {
      return await this.addPapersExclusively(projectID, papers);
    } finally {
      release();
      if (this.addPaperQueues.get(projectID) === queued) {
        this.addPaperQueues.delete(projectID);
      }
    }
  }

  private async addPapersExclusively(
    projectID: string,
    papers: readonly ResearchWorkspacePaper[],
  ) {
    const unique = [
      ...new Map(papers.map((paper) => [paper.sourceID, paper])).values(),
    ];
    // Validate the entire captured batch before replacing any durable source record.
    for (const paper of unique) await this.validateSource?.(paper);
    for (const paper of unique) {
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
      let contentChanged = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.repository.getSource(paper.sourceID);
        // A notifier may have refreshed this source during an earlier CAS attempt.
        // Revalidate the captured PDF against the current file before every retry.
        await this.validateSource?.(paper);
        contentChanged = Boolean(
          current?.source.contentFingerprint?.value &&
            current.source.contentFingerprint.value !==
              paper.contentFingerprint.value,
        );
        if (contentChanged) {
          await invalidateAffectedProjects();
          await this.validateSource?.(paper);
        }
        try {
          await this.repository.putSource(
            researchWorkspaceSourceRecordFromPaper(paper, this.now()),
            current?.revision,
          );
          break;
        } catch (error) {
          if (
            !(error instanceof ResearchWorkspaceRevisionConflictError) ||
            attempt === 2
          ) {
            throw error;
          }
        }
      }
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
        let membersFile;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const current =
            attempt === 0
              ? bundle
              : await this.repository.getProject(projectID);
          try {
            membersFile = await this.repository.addMembers(
              projectID,
              current.membersRevision,
              additions,
            );
            break;
          } catch (error) {
            if (
              !(error instanceof ResearchWorkspaceRevisionConflictError) ||
              attempt === 2
            ) {
              throw error;
            }
          }
        }
        if (!membersFile) {
          throw new Error("Could not update Research Workspace membership.");
        }
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
      ...(await this.repository
        .getCandidates(projectID)
        .then((inbox) => ({
          candidates: inbox.candidates,
          candidatesRevision: inbox.revision,
        }))
        .catch((error) => {
          warnings.push(
            `Candidate inbox could not be read: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {};
        })),
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
      | "comparisonQuestions"
    >,
  ) {
    const bundle = await this.repository.getProject(projectID);
    await this.repository.updateProject(
      projectID,
      bundle.projectRevision,
      (project) => ({ ...project, ...patch }),
    );
    await this.repository.markArtifactsStaleForMembersRevision({
      projectID,
      membersRevision: bundle.membersRevision,
      reason: "project-operation-inputs-changed",
    });
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
    if (!previous) {
      throw new ResearchWorkspaceNotFoundError("Source", params.sourceID);
    }
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
    if (
      isResearchWorkspaceMemberExcluded(previous) !==
        isResearchWorkspaceMemberExcluded({
          ...previous,
          reviewStatus: params.reviewStatus,
        }) ||
      ["included", "excluded", "maybe"].includes(params.reviewStatus)
    )
      await this.repository.markArtifactsStaleForMembersRevision({
        projectID: params.projectID,
        membersRevision: membersFile.revision,
        reason:
          previous.reviewStatus !== params.reviewStatus
            ? "project-review-scope-changed"
            : "project-member-record-changed",
      });
    return this.details(params.projectID);
  }

  async updateReadingState(params: {
    projectID: string;
    sourceID: string;
    readingProgress?: ResearchWorkspaceProjectMember["readingProgress"];
    understanding?: ResearchWorkspaceProjectMember["understanding"];
  }) {
    const bundle = await this.repository.getProject(params.projectID);
    if (!bundle.members.some((member) => member.sourceID === params.sourceID))
      throw new Error("Project source not found.");
    await this.repository.updateMembers(
      params.projectID,
      bundle.membersRevision,
      (members) =>
        members.map((member) =>
          member.sourceID === params.sourceID
            ? {
                ...member,
                readingProgress:
                  params.readingProgress ?? memberReadingProgress(member),
                understanding:
                  params.understanding ?? memberUnderstanding(member),
                updatedAt: timestamp(this.now),
              }
            : member,
        ),
    );
    return this.details(params.projectID);
  }

  async saveCandidate(params: {
    projectID: string;
    candidateID: string;
    metadata: ResearchWorkspaceCandidate["metadata"];
    provenance: ResearchWorkspaceCandidate["provenance"];
    userNote?: string;
  }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const inbox = await this.repository.getCandidates(params.projectID);
      const existing = inbox.candidates.find(
        (candidate) => candidate.candidateID === params.candidateID,
      );
      if (existing) {
        if (
          researchWorkspaceArtifactPayloadFingerprint({
            metadata: existing.metadata,
            provenance: existing.provenance,
          }) !==
          researchWorkspaceArtifactPayloadFingerprint({
            metadata: params.metadata,
            provenance: params.provenance,
          })
        )
          throw new Error(
            "Candidate identity already exists with different metadata or provenance.",
          );
        return existing;
      }
      const now = timestamp(this.now);
      const candidate: ResearchWorkspaceCandidate = {
        candidateID: params.candidateID,
        metadata: params.metadata,
        provenance: params.provenance,
        ...(params.userNote?.trim()
          ? { userNote: params.userNote.trim() }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.repository.updateCandidates(
          params.projectID,
          inbox.revision,
          (candidates) => [...candidates, candidate],
        );
        return candidate;
      } catch (error) {
        if (
          !(error instanceof ResearchWorkspaceRevisionConflictError) ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("Could not save candidate.");
  }

  async updateCandidate(params: {
    projectID: string;
    candidateID: string;
    expectedRevision: number;
    userNote?: string;
    zoteroItem?: ResearchWorkspaceCandidate["zoteroItem"];
  }) {
    const inbox = await this.repository.getCandidates(params.projectID);
    const existing = inbox.candidates.find(
      (candidate) => candidate.candidateID === params.candidateID,
    );
    if (!existing) throw new Error("Candidate not found.");
    if (
      existing.binding &&
      params.zoteroItem &&
      (existing.binding.libraryID !== params.zoteroItem.libraryID ||
        existing.binding.itemKey !== params.zoteroItem.itemKey)
    )
      throw new Error(
        "The linked Zotero item must match this candidate's exact PDF binding.",
      );
    return this.repository.updateCandidates(
      params.projectID,
      params.expectedRevision,
      (candidates) =>
        candidates.map((candidate) =>
          candidate.candidateID === params.candidateID
            ? {
                ...candidate,
                ...(params.userNote !== undefined
                  ? { userNote: params.userNote.trim() || undefined }
                  : {}),
                ...(params.zoteroItem ? { zoteroItem: params.zoteroItem } : {}),
                updatedAt: timestamp(this.now),
              }
            : candidate,
        ),
    );
  }

  async bindCandidate(params: {
    projectID: string;
    candidateID: string;
    paper: ResearchWorkspacePaper;
  }) {
    const inbox = await this.repository.getCandidates(params.projectID);
    const candidate = inbox.candidates.find(
      (entry) => entry.candidateID === params.candidateID,
    );
    if (!candidate) throw new Error("Candidate not found.");
    if (
      candidate.binding &&
      candidate.binding.sourceID !== params.paper.sourceID
    )
      throw new Error(
        "This candidate is already bound to a different PDF. Create another candidate for a different source.",
      );
    // Source first, durable binding second, member last. Recovery replays the last
    // step from the binding without re-extracting or making library writes.
    const current = await this.repository.getSource(params.paper.sourceID);
    await this.validateSource?.(params.paper);
    const changedSource =
      current?.source.contentFingerprint?.value !==
      params.paper.contentFingerprint.value;
    const invalidate = async () => {
      if (!changedSource) return;
      for (const projectID of await this.repository.listProjectIDsForSource(
        params.paper.sourceID,
        { includeArchived: true },
      ))
        await this.repository.markArtifactsStaleForSource({
          projectID,
          sourceID: params.paper.sourceID,
          contentFingerprint: params.paper.contentFingerprint.value,
        });
    };
    await invalidate();
    await this.validateSource?.(params.paper);
    await this.repository.putSource(
      researchWorkspaceSourceRecordFromPaper(params.paper, this.now()),
      current?.revision,
    );
    await invalidate();
    if (
      !candidate.binding ||
      candidate.binding.contentFingerprint !==
        params.paper.contentFingerprint.value
    ) {
      const paper = params.paper;
      await this.repository.updateCandidates(
        params.projectID,
        inbox.revision,
        (candidates) =>
          candidates.map((entry) =>
            entry.candidateID === params.candidateID
              ? {
                  ...entry,
                  zoteroItem: {
                    libraryID: paper.libraryID,
                    itemKey: paper.itemKey,
                  },
                  binding: {
                    sourceID: paper.sourceID,
                    libraryID: paper.libraryID,
                    itemKey: paper.itemKey,
                    attachmentKey: paper.attachmentKey,
                    contentFingerprint: paper.contentFingerprint.value,
                    boundAt: timestamp(this.now),
                  },
                  updatedAt: timestamp(this.now),
                }
              : entry,
          ),
      );
    }
    await this.repository.recoverCandidateMembers(params.projectID);
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
    await this.repository.markArtifactsStaleForMembersRevision({
      projectID: params.projectID,
      membersRevision: bundle.membersRevision,
      reason: "screening-protocol-changed",
    });
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
