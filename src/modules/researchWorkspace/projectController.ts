import type { ResearchWorkspacePaper } from "./paperSource";
import {
  ResearchWorkspaceNotFoundError,
  type ResearchProject,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceCatalogEntry,
  type ResearchWorkspaceProjectMember,
  type ResearchWorkspaceReviewStatus,
  type ResearchWorkspaceSourceRecord,
} from "./persistence/contracts";
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

  constructor(
    private readonly repository: ResearchWorkspaceProjectRepository,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
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
      if (
        current?.source.contentFingerprint?.value &&
        current.source.contentFingerprint.value !==
          paper.contentFingerprint.value
      ) {
        await this.repository.markArtifactsStaleForSource({
          projectID,
          sourceID: paper.sourceID,
          contentFingerprint: paper.contentFingerprint.value,
        });
      }
      await this.repository.putSource(
        researchWorkspaceSourceRecordFromPaper(paper, this.now()),
        current?.revision,
      );
    }
    if (unique.length) {
      const bundle = await this.repository.getProject(projectID);
      await this.repository.addMembers(
        projectID,
        bundle.membersRevision,
        unique.map((paper) => ({
          sourceID: paper.sourceID,
          role: "candidate" as const,
          reviewStatus: "unreviewed" as const,
        })),
      );
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
    await this.repository.updateMembers(
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
    return this.details(params.projectID);
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
