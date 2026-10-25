import { joinPath, researchProjectDirectory } from "./paths";
import { getResearchWorkspaceProjectOwnedDirectories } from "./projectDeletionPaths";
import { parseResearchWorkspaceCandidates } from "./candidates";
import {
  latestCurrentArtifact,
  projectScopeFingerprint,
} from "../operationInputs";
import type { MasterySession } from "../core/comprehensionCheck/v2/types";
import { stableHash } from "../identity";
import {
  assertResearchWorkspaceID,
  assertResearchWorkspaceMember,
  RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION,
  ResearchWorkspaceFileMissingError,
  ResearchWorkspaceNotFoundError,
  ResearchWorkspaceRevisionConflictError,
  type ResearchProject,
  type ResearchWorkspaceCandidate,
  type ResearchWorkspaceCandidatesFile,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceArtifactFile,
  type ResearchWorkspaceArtifactList,
  type ResearchWorkspaceCatalog,
  type ResearchWorkspaceCatalogEntry,
  type ResearchWorkspaceChangeInboxFile,
  type ResearchWorkspaceMembersFile,
  type ResearchWorkspacePortableExport,
  type ResearchWorkspacePreferences,
  type ResearchWorkspaceProjectBundle,
  type ResearchWorkspaceProjectMember,
  type ResearchWorkspaceRepositoryOptions,
  type ResearchWorkspaceRun,
  type ResearchWorkspaceRunList,
  type ResearchWorkspaceSourceRecord,
} from "./contracts";
import {
  cloneResearchWorkspaceValue,
  SerializedResearchWorkspaceFiles,
} from "./fileStore";
import { getResearchWorkspaceReceiptContract } from "./receiptContract";
import {
  parseResearchWorkspaceArtifactFile,
  parseResearchWorkspaceCatalog,
  parseResearchWorkspaceChangeInboxFile,
  parseResearchWorkspaceMembersFile,
  parseResearchWorkspacePreferencesFile,
  parseResearchWorkspaceProjectFile,
  parseResearchWorkspaceRunFile,
  parseResearchWorkspaceSourceFile,
} from "./validation";
import type {
  ResearchWorkspaceZoteroSyncReceipt,
  ResearchWorkspaceZoteroSyncReceiptFile,
} from "./zoteroSyncContracts";

function zoteroSyncReceiptContract() {
  return getResearchWorkspaceReceiptContract<ResearchWorkspaceZoteroSyncReceiptFile>();
}

function parseResearchWorkspaceZoteroSyncReceiptFile(value: unknown) {
  return zoteroSyncReceiptContract().parse(value);
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function defaultID(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function sortCatalogProjects(entries: ResearchWorkspaceCatalogEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt > right.updatedAt ? -1 : 1;
    }
    return left.projectID.localeCompare(right.projectID);
  });
}

function dueMasteryReviewCount(
  artifacts: readonly ResearchWorkspaceArtifact[],
  now: number,
) {
  const byScope = new Map<string, ResearchWorkspaceArtifact[]>();
  for (const artifact of artifacts) {
    if (artifact.type !== "paper-mastery" || artifact.status !== "complete")
      continue;
    const scope = [...artifact.sourceIDs].sort().join("\n");
    const history = byScope.get(scope) ?? [];
    history.push(artifact);
    byScope.set(scope, history);
  }
  let count = 0;
  for (const history of byScope.values()) {
    const latest = latestCurrentArtifact(history, "paper-mastery");
    const session = (
      latest?.payload as { session?: Partial<MasterySession> } | undefined
    )?.session;
    if (session?.phase !== "active") continue;
    if (
      Object.values(session.conceptStates ?? {}).some(
        (state) =>
          typeof state?.nextReviewAt === "string" &&
          Date.parse(state.nextReviewAt) <= now,
      )
    )
      count += 1;
  }
  return count;
}

function emptyCatalog(now: string): ResearchWorkspaceCatalog {
  return {
    schemaVersion: RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
    revision: 0,
    projects: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface ProjectDeletionIntent {
  schemaVersion: 1;
  revision: number;
  entry: ResearchWorkspaceCatalogEntry;
}

function parseProjectDeletionIntent(value: unknown): ProjectDeletionIntent {
  const input = value as Partial<ProjectDeletionIntent> | undefined;
  if (
    !input ||
    input.schemaVersion !== 1 ||
    typeof input.revision !== "number" ||
    !Number.isInteger(input.revision) ||
    !input.entry
  ) {
    throw new Error("Invalid project deletion record.");
  }
  const catalog = parseResearchWorkspaceCatalog({
    ...emptyCatalog("2000-01-01T00:00:00.000Z"),
    revision: input.revision,
    projects: [input.entry],
  });
  return {
    schemaVersion: 1,
    revision: input.revision,
    entry: catalog.projects[0],
  };
}

function defaultPreferences(now: string) {
  return {
    schemaVersion: RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
    revision: 0,
    preferences: {
      responseLanguage: "English",
      maxPaperCharacters: 1_500_000,
      artifactHistoryLimit: 20,
    },
    createdAt: now,
    updatedAt: now,
  } as const;
}

export function researchWorkspaceSourcePathID(sourceID: string) {
  if (!sourceID.trim()) throw new Error("SourceID is required.");
  return `${stableHash(sourceID, 2166136261)}${stableHash(
    sourceID,
    2246822519,
  )}${sourceID.length.toString(16).padStart(4, "0")}`;
}

export interface CreateResearchWorkspaceProjectInput {
  projectID?: string;
  name: string;
  description?: string;
  researchQuestion?: string;
  scope?: ResearchProject["scope"];
  templateSnapshot?: ResearchProject["templateSnapshot"];
  templateAssumptions?: ResearchProject["templateAssumptions"];
  capabilityPresetIDs?: ResearchProject["capabilityPresetIDs"];
  defaultEngineMode?: ResearchProject["defaultEngineMode"];
}

export interface CreateResearchWorkspaceArtifactInput<T = unknown>
  extends Omit<
    ResearchWorkspaceArtifact<T>,
    | "artifactID"
    | "projectID"
    | "version"
    | "createdAt"
    | "updatedAt"
    | "supersedesArtifactID"
  > {
  artifactID?: string;
  supersedeLatest?: boolean;
}

export interface CreateResearchWorkspaceRunInput
  extends Omit<ResearchWorkspaceRun, "runID" | "updatedAt"> {
  runID?: string;
}

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "preparing",
  "running",
  "cancelling",
]);

const MAX_ARTIFACT_STALE_PROPAGATION_ROUNDS = 32;

function artifactPropagationSignature(
  artifacts: readonly ResearchWorkspaceArtifact[],
) {
  return JSON.stringify(
    [...artifacts]
      .sort((left, right) => left.artifactID.localeCompare(right.artifactID))
      .map((artifact) => [
        artifact.artifactID,
        artifact.updatedAt,
        artifact.status,
        artifact.staleReasons ?? [],
        artifact.lineage.inputs,
        artifact.lineage.artifactInputs ?? [],
        artifact.lineage.membersRevision,
      ]),
  );
}

export class ResearchWorkspaceProjectRepository {
  private readonly deletions = new Map<string, Promise<void>>();
  private readonly files: SerializedResearchWorkspaceFiles;
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly warn: (message: string) => void;

  constructor(options: ResearchWorkspaceRepositoryOptions) {
    this.rootDir = options.rootDir;
    this.files = new SerializedResearchWorkspaceFiles(options.fileOps);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultID;
    this.warn = options.warn ?? (() => undefined);
  }

  private timestamp() {
    return this.now().toISOString();
  }

  get catalogPath() {
    return joinPath(this.rootDir, "catalog-v1.json");
  }

  get preferencesPath() {
    return joinPath(this.rootDir, "preferences-v1.json");
  }

  get projectsRoot() {
    return joinPath(this.rootDir, "projects");
  }

  get sourcesRoot() {
    return joinPath(this.rootDir, "sources");
  }

  get cacheRoot() {
    return joinPath(this.rootDir, "cache");
  }

  getProjectRoot(projectID: string) {
    return researchProjectDirectory(this.rootDir, projectID);
  }

  getProjectPath(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "project.json");
  }

  private getDeletionPath(projectID: string) {
    return joinPath(
      this.rootDir,
      "deletions",
      `project-${assertResearchWorkspaceID(projectID, "projectID")}.json`,
    );
  }

  async assertProjectDeletionSafe(projectID: string) {
    const directories = getResearchWorkspaceProjectOwnedDirectories(
      this.rootDir,
      projectID,
    );
    for (const path of [...directories, this.getDeletionPath(projectID)]) {
      await this.files.assertSafeRemoval(path, this.rootDir);
    }
  }

  private async assertProjectNotDeleting(projectID: string) {
    if (
      this.deletions.has(projectID) ||
      (await this.files.exists(this.getDeletionPath(projectID)))
    ) {
      throw new Error(
        "Project deletion is incomplete. Use Delete project again to finish cleanup.",
      );
    }
  }

  getMembersPath(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "members.json");
  }

  getCandidatesPath(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "candidates-v1.json");
  }

  async getCandidates(
    projectID: string,
  ): Promise<ResearchWorkspaceCandidatesFile> {
    await this.getProject(projectID);
    const file = await this.files.read(
      this.getCandidatesPath(projectID),
      parseResearchWorkspaceCandidates,
    );
    if (file && file.projectID !== projectID)
      throw new Error("Candidate inbox belongs to another project.");
    return file ?? { schemaVersion: 1, revision: 0, projectID, candidates: [] };
  }

  async updateCandidates(
    projectID: string,
    expectedRevision: number,
    mutate: (
      candidates: ResearchWorkspaceCandidate[],
    ) => ResearchWorkspaceCandidate[],
  ) {
    await this.getProject(projectID);
    return this.files.mutate({
      path: this.getCandidatesPath(projectID),
      parser: parseResearchWorkspaceCandidates,
      expectedRevision,
      create: (): ResearchWorkspaceCandidatesFile => ({
        schemaVersion: 1,
        revision: 0,
        projectID,
        candidates: [],
      }),
      mutate: (file) =>
        parseResearchWorkspaceCandidates({
          ...file,
          candidates: mutate(file.candidates),
        }),
    });
  }

  async recoverCandidateMembers(projectID: string) {
    const inbox = await this.getCandidates(projectID);
    for (const candidate of inbox.candidates) {
      const binding = candidate.binding;
      if (!binding) continue;
      const source = await this.getSource(binding.sourceID);
      if (
        !source ||
        source.source.identity.libraryID !== binding.libraryID ||
        source.source.identity.itemKey !== binding.itemKey ||
        source.source.identity.attachmentKey !== binding.attachmentKey
      )
        continue;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const bundle = await this.getProject(projectID);
        if (
          bundle.members.some((member) => member.sourceID === binding.sourceID)
        )
          break;
        try {
          const members = await this.addMembers(
            projectID,
            bundle.membersRevision,
            [{ sourceID: binding.sourceID, role: "candidate" }],
          );
          await this.markArtifactsStaleForMembersRevision({
            projectID,
            membersRevision: members.revision,
          });
          break;
        } catch (error) {
          if (
            !(error instanceof ResearchWorkspaceRevisionConflictError) ||
            attempt === 2
          )
            throw error;
        }
      }
    }
  }

  getChangeInboxPath(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "change-inbox.json");
  }

  getSyncReceiptsRoot(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "sync-receipts");
  }

  getSyncReceiptPath(projectID: string, receiptID: string) {
    return joinPath(
      this.getSyncReceiptsRoot(projectID),
      `receipt-${assertResearchWorkspaceID(receiptID, "receiptID")}.json`,
    );
  }

  getArtifactPath(projectID: string, artifactID: string) {
    return joinPath(
      this.getProjectRoot(projectID),
      "artifacts",
      `artifact-${assertResearchWorkspaceID(artifactID, "artifactID")}.json`,
    );
  }

  getRunPath(projectID: string, runID: string) {
    return joinPath(
      this.getProjectRoot(projectID),
      "runs",
      `run-${assertResearchWorkspaceID(runID, "runID")}.json`,
    );
  }

  getSourcePath(sourceID: string) {
    return joinPath(
      this.sourcesRoot,
      `source-${researchWorkspaceSourcePathID(sourceID)}.json`,
    );
  }

  private async ensureProjectDirectories(projectID: string) {
    const root = this.getProjectRoot(projectID);
    await this.files.ensureDirectory(root);
    await this.files.ensureDirectory(joinPath(root, "artifacts"));
    await this.files.ensureDirectory(joinPath(root, "runs"));
    await this.files.ensureDirectory(this.getSyncReceiptsRoot(projectID));
  }

  async getCatalog() {
    const catalog = await this.files.read(
      this.catalogPath,
      parseResearchWorkspaceCatalog,
    );
    return catalog ?? emptyCatalog(this.timestamp());
  }

  hasCatalog() {
    return this.files.exists(this.catalogPath);
  }

  async listProjects(
    options: {
      includeArchived?: boolean;
      includeDueMasteryReviews?: boolean;
    } = {},
  ) {
    const catalog = await this.getCatalog();
    const entries = catalog.projects.filter(
      (entry) => options.includeArchived || !entry.archivedAt,
    );
    if (!options.includeDueMasteryReviews) return entries;
    const now = this.now().getTime();
    return Promise.all(
      entries.map(async (entry) => {
        try {
          const { artifacts } = await this.listArtifacts(entry.projectID);
          return {
            ...entry,
            dueMasteryReviewCount: dueMasteryReviewCount(artifacts, now),
          };
        } catch {
          // Keep damaged or incompletely deleted projects visible for recovery.
          return entry;
        }
      }),
    );
  }

  async listProjectIDsForSource(
    sourceID: string,
    options: { includeArchived?: boolean } = { includeArchived: true },
  ) {
    const entries = await this.listProjects({
      includeArchived: options.includeArchived ?? true,
    });
    const projectIDs: string[] = [];
    for (const entry of entries) {
      try {
        const bundle = await this.getProject(entry.projectID);
        if (bundle.members.some((member) => member.sourceID === sourceID)) {
          projectIDs.push(entry.projectID);
        }
      } catch {
        // A damaged project must not prevent other projects from being invalidated.
      }
    }
    return projectIDs.sort();
  }

  async getPreferences() {
    const stored = await this.files.read(
      this.preferencesPath,
      parseResearchWorkspacePreferencesFile,
    );
    return stored ?? defaultPreferences(this.timestamp());
  }

  async updatePreferences(
    expectedRevision: number,
    mutate: (
      preferences: ResearchWorkspacePreferences,
    ) => ResearchWorkspacePreferences,
  ) {
    const timestamp = this.timestamp();
    return this.files.mutate({
      path: this.preferencesPath,
      parser: parseResearchWorkspacePreferencesFile,
      expectedRevision,
      create: () => defaultPreferences(timestamp),
      mutate: (file) => {
        const preferences = mutate(
          cloneResearchWorkspaceValue(file.preferences),
        );
        const candidate = {
          ...file,
          preferences,
          updatedAt: timestamp,
        };
        parseResearchWorkspacePreferencesFile(candidate);
        return candidate;
      },
    });
  }

  private async updateCatalog(
    mutate: (catalog: ResearchWorkspaceCatalog) => ResearchWorkspaceCatalog,
  ) {
    const timestamp = this.timestamp();
    return this.files.mutate({
      path: this.catalogPath,
      parser: parseResearchWorkspaceCatalog,
      create: () => emptyCatalog(timestamp),
      mutate: (catalog) => {
        const next = mutate(catalog);
        next.schemaVersion = RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION;
        next.updatedAt = timestamp;
        next.projects = sortCatalogProjects(next.projects);
        return next;
      },
    });
  }

  private async catalogEntry(projectID: string) {
    const bundle = await this.getProject(projectID);
    const artifacts = await this.listArtifacts(projectID);
    const now = this.timestamp();
    return {
      projectID,
      name: bundle.project.name,
      updatedAt: bundle.project.updatedAt,
      ...(bundle.project.archivedAt
        ? { archivedAt: bundle.project.archivedAt }
        : {}),
      memberCount: bundle.members.length,
      staleArtifactCount: artifacts.artifacts.filter(
        (artifact) => artifact.status === "stale",
      ).length,
      dueMasteryReviewCount: dueMasteryReviewCount(
        artifacts.artifacts,
        Date.parse(now),
      ),
    } satisfies ResearchWorkspaceCatalogEntry;
  }

  private async syncCatalogEntry(projectID: string) {
    const entry = await this.catalogEntry(projectID);
    await this.updateCatalog((catalog) =>
      this.files.isFrozen(this.getProjectRoot(projectID))
        ? catalog
        : {
            ...catalog,
            projects: [
              ...catalog.projects.filter(
                (item) => item.projectID !== projectID,
              ),
              entry,
            ],
          },
    );
  }

  async createProject(input: CreateResearchWorkspaceProjectInput) {
    const name = input.name.trim();
    if (!name) throw new Error("Project name is required.");
    const projectID = assertResearchWorkspaceID(
      input.projectID ?? this.idFactory("project"),
      "projectID",
    );
    await this.assertProjectNotDeleting(projectID);
    // A successful deletion keeps stale writes blocked until an explicit new
    // creation (including a deterministic quick project) starts.
    this.files.thawDirectories(
      getResearchWorkspaceProjectOwnedDirectories(this.rootDir, projectID),
    );
    const timestamp = this.timestamp();
    await this.ensureProjectDirectories(projectID);
    const project: ResearchProject = {
      projectID,
      name,
      ...(input.description?.trim()
        ? { description: input.description.trim() }
        : {}),
      ...(input.researchQuestion?.trim()
        ? { researchQuestion: input.researchQuestion.trim() }
        : {}),
      ...(input.scope
        ? { scope: cloneResearchWorkspaceValue(input.scope) }
        : {}),
      ...(input.templateSnapshot
        ? {
            templateSnapshot: cloneResearchWorkspaceValue(
              input.templateSnapshot,
            ),
          }
        : {}),
      ...(input.templateAssumptions !== undefined
        ? {
            templateAssumptions: cloneResearchWorkspaceValue(
              input.templateAssumptions,
            ),
          }
        : {}),
      ...(input.capabilityPresetIDs !== undefined
        ? { capabilityPresetIDs: [...input.capabilityPresetIDs] }
        : {}),
      ...(input.defaultEngineMode
        ? { defaultEngineMode: input.defaultEngineMode }
        : {}),
      artifactIDs: [],
      runIDs: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const projectFile = await this.files.writeNew(
      this.getProjectPath(projectID),
      {
        schemaVersion: RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION,
        revision: 0,
        project,
      },
    );
    const membersFile = await this.files.writeNew(
      this.getMembersPath(projectID),
      {
        schemaVersion: RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
        revision: 0,
        projectID,
        members: [],
      },
    );
    await this.syncCatalogEntry(projectID);
    return {
      project: projectFile.project,
      projectRevision: projectFile.revision,
      members: membersFile.members,
      membersRevision: membersFile.revision,
    } satisfies ResearchWorkspaceProjectBundle;
  }

  async getProject(projectID: string): Promise<ResearchWorkspaceProjectBundle> {
    assertResearchWorkspaceID(projectID, "projectID");
    await this.assertProjectNotDeleting(projectID);
    const [projectFile, membersFile] = await Promise.all([
      this.files.read(
        this.getProjectPath(projectID),
        parseResearchWorkspaceProjectFile,
      ),
      this.files.read(
        this.getMembersPath(projectID),
        parseResearchWorkspaceMembersFile,
      ),
    ]);
    if (!projectFile)
      throw new ResearchWorkspaceNotFoundError("Project", projectID);
    const repairedMembersFile =
      membersFile ?? (await this.repairMissingMembersFile(projectID));
    if (repairedMembersFile.projectID !== projectID) {
      throw new Error(
        `Project ${projectID} members are bound to another project.`,
      );
    }
    return {
      project: projectFile.project,
      projectRevision: projectFile.revision,
      members: repairedMembersFile.members,
      membersRevision: repairedMembersFile.revision,
    };
  }

  private async repairMissingMembersFile(projectID: string) {
    const path = this.getMembersPath(projectID);
    const emptyMembersFile: ResearchWorkspaceMembersFile = {
      schemaVersion: RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
      revision: 0,
      projectID,
      members: [],
    };
    try {
      const repaired = await this.files.writeMissing(
        path,
        emptyMembersFile,
        parseResearchWorkspaceMembersFile,
      );
      this.warn(
        `Project ${projectID} was missing members.json; restored an empty revision-0 membership file.`,
      );
      return repaired;
    } catch (error) {
      const concurrentlyRepaired = await this.files.read(
        path,
        parseResearchWorkspaceMembersFile,
      );
      if (concurrentlyRepaired) {
        return concurrentlyRepaired;
      }
      throw error;
    }
  }

  async getChangeInbox(
    projectID: string,
  ): Promise<ResearchWorkspaceChangeInboxFile> {
    await this.getProject(projectID);
    const inbox = await this.files.read(
      this.getChangeInboxPath(projectID),
      parseResearchWorkspaceChangeInboxFile,
    );
    if (inbox && inbox.projectID !== projectID) {
      throw new Error(
        `Project ${projectID} change inbox is bound to another project.`,
      );
    }
    return (
      inbox ?? {
        schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
        revision: 0,
        projectID,
        snapshots: [],
        changes: [],
      }
    );
  }

  async updateChangeInbox(
    projectID: string,
    expectedRevision: number | undefined,
    mutate: (
      inbox: ResearchWorkspaceChangeInboxFile,
    ) => ResearchWorkspaceChangeInboxFile,
  ): Promise<ResearchWorkspaceChangeInboxFile> {
    await this.getProject(projectID);
    const next = await this.files.mutate({
      path: this.getChangeInboxPath(projectID),
      parser: parseResearchWorkspaceChangeInboxFile,
      expectedRevision,
      create: () => ({
        schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
        revision: 0,
        projectID,
        snapshots: [],
        changes: [],
      }),
      mutate: (file) => {
        if (file.projectID !== projectID) {
          throw new Error(
            `Project ${projectID} change inbox is bound to another project.`,
          );
        }
        const changed = mutate(cloneResearchWorkspaceValue(file));
        if (changed.projectID !== projectID) {
          throw new Error("A change inbox update cannot change projectID.");
        }
        const candidate = {
          ...changed,
          schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
          revision: file.revision,
          projectID,
        };
        parseResearchWorkspaceChangeInboxFile(candidate);
        return candidate;
      },
    });
    return parseResearchWorkspaceChangeInboxFile(next);
  }

  async createZoteroSyncReceipt(
    projectID: string,
    receipt: ResearchWorkspaceZoteroSyncReceipt,
  ) {
    await this.getProject(projectID);
    if (receipt.projectID !== projectID) {
      throw new Error("A Zotero sync receipt must match its projectID.");
    }
    await this.files.ensureDirectory(this.getSyncReceiptsRoot(projectID));
    const candidate: ResearchWorkspaceZoteroSyncReceiptFile = {
      schemaVersion: zoteroSyncReceiptContract().schemaVersion,
      revision: 0,
      receipt: cloneResearchWorkspaceValue(receipt),
    };
    parseResearchWorkspaceZoteroSyncReceiptFile(candidate);
    const created = await this.files.writeNew(
      this.getSyncReceiptPath(projectID, receipt.receiptID),
      candidate,
    );
    return parseResearchWorkspaceZoteroSyncReceiptFile(created);
  }

  async getZoteroSyncReceipt(projectID: string, receiptID: string) {
    await this.getProject(projectID);
    const file = await this.files.read(
      this.getSyncReceiptPath(projectID, receiptID),
      parseResearchWorkspaceZoteroSyncReceiptFile,
    );
    if (file && file.receipt.projectID !== projectID) {
      throw new Error(
        `Zotero sync receipt ${receiptID} is bound to another project.`,
      );
    }
    return file;
  }

  async updateZoteroSyncReceipt(
    projectID: string,
    receiptID: string,
    expectedRevision: number,
    mutate: (
      receipt: ResearchWorkspaceZoteroSyncReceipt,
    ) => ResearchWorkspaceZoteroSyncReceipt,
  ) {
    await this.getProject(projectID);
    const next = await this.files.mutate({
      path: this.getSyncReceiptPath(projectID, receiptID),
      parser: parseResearchWorkspaceZoteroSyncReceiptFile,
      expectedRevision,
      mutate: (file) => {
        const receipt = mutate(cloneResearchWorkspaceValue(file.receipt));
        if (
          receipt.receiptID !== receiptID ||
          receipt.projectID !== projectID
        ) {
          throw new Error(
            "A Zotero sync receipt update cannot change identity.",
          );
        }
        const candidate: ResearchWorkspaceZoteroSyncReceiptFile = {
          ...file,
          receipt,
        };
        parseResearchWorkspaceZoteroSyncReceiptFile(candidate);
        return candidate;
      },
    });
    return parseResearchWorkspaceZoteroSyncReceiptFile(next);
  }

  async listZoteroSyncReceipts(projectID: string) {
    await this.getProject(projectID);
    const root = this.getSyncReceiptsRoot(projectID);
    const paths = (await this.files.listDirectory(root))
      .filter((path) => /[\\/]receipt-[^\\/]+\.json$/i.test(path))
      .sort();
    const receipts: ResearchWorkspaceZoteroSyncReceiptFile[] = [];
    for (const path of paths) {
      const file = await this.files.read(
        path,
        parseResearchWorkspaceZoteroSyncReceiptFile,
      );
      if (!file) continue;
      if (file.receipt.projectID !== projectID) {
        throw new Error(
          `Zotero sync receipt ${file.receipt.receiptID} is bound to another project.`,
        );
      }
      receipts.push(file);
    }
    return receipts.sort((left, right) => {
      if (left.receipt.createdAt !== right.receipt.createdAt) {
        return left.receipt.createdAt > right.receipt.createdAt ? -1 : 1;
      }
      return left.receipt.receiptID.localeCompare(right.receipt.receiptID);
    });
  }

  async updateProject(
    projectID: string,
    expectedRevision: number,
    mutate: (project: ResearchProject) => ResearchProject,
  ) {
    const timestamp = this.timestamp();
    const next = await this.files.mutate({
      path: this.getProjectPath(projectID),
      parser: parseResearchWorkspaceProjectFile,
      expectedRevision,
      mutate: (file) => {
        const project = mutate(cloneResearchWorkspaceValue(file.project));
        if (project.projectID !== projectID) {
          throw new Error("A project update cannot change projectID.");
        }
        if (
          JSON.stringify(project.templateSnapshot ?? null) !==
          JSON.stringify(file.project.templateSnapshot ?? null)
        ) {
          throw new Error(
            "A project update cannot change its template provenance snapshot.",
          );
        }
        project.name = project.name.trim();
        if (!project.name) throw new Error("Project name is required.");
        project.updatedAt = timestamp;
        const candidate = { ...file, project };
        parseResearchWorkspaceProjectFile(candidate);
        return candidate;
      },
    });
    await this.syncCatalogEntry(projectID);
    return next;
  }

  async archiveProject(projectID: string, expectedRevision: number) {
    const timestamp = this.timestamp();
    return this.updateProject(projectID, expectedRevision, (project) => ({
      ...project,
      archivedAt: timestamp,
    }));
  }

  /** Returns an archived project to the active list without other changes. */
  async unarchiveProject(projectID: string, expectedRevision: number) {
    return this.updateProject(projectID, expectedRevision, (project) => {
      const { archivedAt: _archivedAt, ...active } = project;
      return active;
    });
  }

  deleteProject(
    projectID: string,
    beforeRemove?: () => Promise<unknown>,
  ): Promise<void> {
    const pending = this.deletions.get(projectID);
    if (pending) return pending;
    const operation = this.deleteProjectOnce(projectID, beforeRemove).finally(
      () => {
        this.deletions.delete(projectID);
      },
    );
    this.deletions.set(projectID, operation);
    return operation;
  }

  private async deleteProjectOnce(
    projectID: string,
    beforeRemove?: () => Promise<unknown>,
  ) {
    const directories = getResearchWorkspaceProjectOwnedDirectories(
      this.rootDir,
      projectID,
    );
    await this.assertProjectDeletionSafe(projectID);
    const intentPath = this.getDeletionPath(projectID);
    let intent = await this.files.read(intentPath, parseProjectDeletionIntent);
    if (!intent) {
      const catalog = await this.getCatalog();
      const entry = catalog.projects.find(
        (project) => project.projectID === projectID,
      );
      if (!entry) {
        // Retrying a completed delete is harmless; unknown IDs confer no
        // authority to remove similarly named runtime directories.
        if (!(await this.files.exists(this.getProjectPath(projectID)))) return;
        throw new Error(
          "Repair the project catalog before deleting this project.",
        );
      }
      intent = await this.files.writeNew(intentPath, {
        schemaVersion: 1 as const,
        revision: 0,
        entry,
      });
    }
    if (intent.entry.projectID !== projectID)
      throw new Error("Project deletion record belongs to another project.");
    await this.files.freezeDirectories(directories);
    // CLI allocation receipts must survive until all external cleanup succeeds.
    await beforeRemove?.();
    await this.assertProjectDeletionSafe(projectID);
    // Keep project metadata until the auxiliary directories have been removed.
    for (const path of [...directories.slice(1), directories[0]]) {
      await this.files.removeFrozenDirectory(path);
    }
    await this.updateCatalog((catalog) => ({
      ...catalog,
      projects: catalog.projects.filter(
        (entry) => entry.projectID !== projectID,
      ),
    }));
    await this.files.remove(intentPath);
  }

  async updateMembers(
    projectID: string,
    expectedRevision: number,
    mutate: (
      members: ResearchWorkspaceProjectMember[],
    ) => ResearchWorkspaceProjectMember[],
  ) {
    const next = await this.files.mutate({
      path: this.getMembersPath(projectID),
      parser: parseResearchWorkspaceMembersFile,
      expectedRevision,
      mutate: (file) => {
        const members = mutate(cloneResearchWorkspaceValue(file.members));
        for (const member of members) assertResearchWorkspaceMember(member);
        const candidate = { ...file, members };
        parseResearchWorkspaceMembersFile(candidate);
        return candidate;
      },
    });
    const project = await this.getProject(projectID);
    await this.updateProject(
      projectID,
      project.projectRevision,
      (current) => current,
    );
    return next;
  }

  async addMembers(
    projectID: string,
    expectedRevision: number,
    additions: Array<
      Pick<ResearchWorkspaceProjectMember, "sourceID"> &
        Partial<
          Pick<
            ResearchWorkspaceProjectMember,
            "role" | "reviewStatus" | "exclusionReason" | "userNote"
          >
        >
    >,
  ) {
    for (const addition of additions) {
      if (!(await this.getSource(addition.sourceID))) {
        throw new ResearchWorkspaceNotFoundError("Source", addition.sourceID);
      }
    }
    const timestamp = this.timestamp();
    return this.updateMembers(projectID, expectedRevision, (members) => {
      const next = [...members];
      for (const addition of additions) {
        const index = next.findIndex(
          (member) => member.sourceID === addition.sourceID,
        );
        const previous = index >= 0 ? next[index] : undefined;
        const member: ResearchWorkspaceProjectMember = {
          sourceID: addition.sourceID,
          role: addition.role ?? previous?.role ?? "candidate",
          reviewStatus:
            addition.reviewStatus ?? previous?.reviewStatus ?? "unreviewed",
          ...(previous?.readingProgress
            ? { readingProgress: previous.readingProgress }
            : {}),
          ...(previous?.understanding
            ? { understanding: previous.understanding }
            : {}),
          ...(addition.exclusionReason?.trim()
            ? { exclusionReason: addition.exclusionReason.trim() }
            : previous?.exclusionReason
              ? { exclusionReason: previous.exclusionReason }
              : {}),
          ...(addition.userNote?.trim()
            ? { userNote: addition.userNote.trim() }
            : previous?.userNote
              ? { userNote: previous.userNote }
              : {}),
          ...(previous?.screeningEvents
            ? {
                screeningEvents: cloneResearchWorkspaceValue(
                  previous.screeningEvents,
                ),
              }
            : {}),
          addedAt: previous?.addedAt ?? timestamp,
          updatedAt: timestamp,
        };
        assertResearchWorkspaceMember(member);
        if (index >= 0) next[index] = member;
        else next.push(member);
      }
      return next;
    });
  }

  async putSource(
    source: ResearchWorkspaceSourceRecord,
    expectedRevision?: number,
  ) {
    const path = this.getSourcePath(source.sourceID);
    await this.files.ensureDirectory(this.sourcesRoot);
    return this.files.mutate({
      path,
      parser: parseResearchWorkspaceSourceFile,
      expectedRevision,
      create: () => ({
        schemaVersion: RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION,
        revision: 0,
        source,
      }),
      mutate: (file) => {
        if (file.source.sourceID !== source.sourceID) {
          throw new Error(
            "Source path digest collision detected; existing source was preserved.",
          );
        }
        const candidate = {
          ...file,
          source: cloneResearchWorkspaceValue(source),
        };
        parseResearchWorkspaceSourceFile(candidate);
        return candidate;
      },
    });
  }

  async mutateSourceAtRevision(
    sourceID: string,
    expectedRevision: number,
    mutate: (
      source: ResearchWorkspaceSourceRecord,
    ) => ResearchWorkspaceSourceRecord | undefined,
  ) {
    let changed = false;
    const file = await this.files.mutate({
      path: this.getSourcePath(sourceID),
      parser: parseResearchWorkspaceSourceFile,
      expectedRevision,
      mutate: (current) => {
        if (current.source.sourceID !== sourceID) {
          throw new Error(
            "Source path digest collision detected; existing source was preserved.",
          );
        }
        const source = mutate(cloneResearchWorkspaceValue(current.source));
        if (!source) return undefined;
        if (source.sourceID !== sourceID) {
          throw new Error("A source update cannot change sourceID.");
        }
        const candidate = {
          ...current,
          source: cloneResearchWorkspaceValue(source),
        };
        parseResearchWorkspaceSourceFile(candidate);
        changed = true;
        return candidate;
      },
    });
    return { file, changed };
  }

  async getSource(sourceID: string) {
    const file = await this.files.read(
      this.getSourcePath(sourceID),
      parseResearchWorkspaceSourceFile,
    );
    if (file && file.source.sourceID !== sourceID) {
      throw new Error("Source path digest collision detected.");
    }
    return file;
  }

  async getArtifact(projectID: string, artifactID: string) {
    const file = await this.files.read(
      this.getArtifactPath(projectID, artifactID),
      parseResearchWorkspaceArtifactFile,
    );
    if (file && file.artifact.projectID !== projectID) {
      throw new Error(`Artifact ${artifactID} belongs to another project.`);
    }
    return file;
  }

  async listArtifacts(
    projectID: string,
  ): Promise<ResearchWorkspaceArtifactList> {
    const bundle = await this.getProject(projectID);
    const artifacts: ResearchWorkspaceArtifact[] = [];
    const warnings: string[] = [];
    for (const artifactID of bundle.project.artifactIDs) {
      try {
        const file = await this.getArtifact(projectID, artifactID);
        if (file) artifacts.push(file.artifact);
        else warnings.push(`Artifact ${artifactID} is missing.`);
      } catch (error) {
        warnings.push(
          `Artifact ${artifactID} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    artifacts.sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt > right.updatedAt ? -1 : 1;
      }
      return left.artifactID.localeCompare(right.artifactID);
    });
    return { artifacts, warnings };
  }

  async createArtifact<T>(
    projectID: string,
    input: CreateResearchWorkspaceArtifactInput<T>,
  ) {
    const bundle = await this.getProject(projectID);
    const sameType = await this.listSameScopeArtifacts(projectID, {
      type: input.type,
      sourceIDs: input.sourceIDs,
      operation: input.lineage.operation,
    });
    const previous = sameType
      .filter((artifact) => artifact.status !== "superseded")
      .sort((left, right) => right.version - left.version)[0];
    const version =
      sameType.reduce(
        (maximum, artifact) => Math.max(maximum, artifact.version),
        0,
      ) + 1;
    const artifactID = assertResearchWorkspaceID(
      input.artifactID ?? this.idFactory("artifact"),
      "artifactID",
    );
    const timestamp = this.timestamp();
    const artifact: ResearchWorkspaceArtifact<T> = {
      artifactID,
      projectID,
      type: input.type,
      title: input.title.trim(),
      version,
      status: input.status,
      sourceIDs: [...input.sourceIDs],
      lineage: cloneResearchWorkspaceValue(input.lineage),
      payload: cloneResearchWorkspaceValue(input.payload),
      ...(input.checkpoint
        ? { checkpoint: cloneResearchWorkspaceValue(input.checkpoint) }
        : {}),
      ...(input.staleReasons ? { staleReasons: [...input.staleReasons] } : {}),
      ...(input.lastCurrentAt ? { lastCurrentAt: input.lastCurrentAt } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.supersedeLatest !== false && previous
        ? { supersedesArtifactID: previous.artifactID }
        : {}),
    };
    if (!artifact.title) throw new Error("Artifact title is required.");
    await this.files.ensureDirectory(
      joinPath(this.getProjectRoot(projectID), "artifacts"),
    );
    const artifactFile = {
      schemaVersion: RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
      revision: 0,
      artifact,
    };
    parseResearchWorkspaceArtifactFile(artifactFile);
    const created = await this.files.writeNew(
      this.getArtifactPath(projectID, artifactID),
      artifactFile,
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = attempt === 0 ? bundle : await this.getProject(projectID);
      try {
        await this.files.mutate({
          path: this.getProjectPath(projectID),
          parser: parseResearchWorkspaceProjectFile,
          expectedRevision: current.projectRevision,
          mutate: (file) =>
            file.project.artifactIDs.includes(artifactID)
              ? undefined
              : {
                  ...file,
                  project: {
                    ...file.project,
                    artifactIDs: [...file.project.artifactIDs, artifactID],
                    activeArtifactID: artifactID,
                    updatedAt: timestamp,
                  },
                },
        });
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
    if (input.supersedeLatest !== false && previous) {
      const previousFile = await this.getArtifact(
        projectID,
        previous.artifactID,
      );
      if (previousFile) {
        await this.updateArtifact(
          projectID,
          previous.artifactID,
          previousFile.revision,
          (current) => ({
            ...current,
            status: "superseded",
            updatedAt: timestamp,
          }),
          false,
        );
        await this.markArtifactsStaleForArtifact({
          projectID,
          artifactID: previous.artifactID,
        });
      }
    }
    await this.pruneArtifactHistory(projectID, artifact);
    await this.syncCatalogEntry(projectID);
    return created;
  }

  /** Artifacts of one type, source scope, and operation, in any status. */
  async listSameScopeArtifacts(
    projectID: string,
    scope: { type: string; sourceIDs: readonly string[]; operation: string },
  ) {
    const history = await this.listArtifacts(projectID);
    const key = [...scope.sourceIDs].sort().join("\n");
    return history.artifacts.filter(
      (artifact) =>
        artifact.type === scope.type &&
        [...artifact.sourceIDs].sort().join("\n") === key &&
        artifact.lineage.operation === scope.operation,
    );
  }

  /**
   * Marks earlier versions superseded and their dependents stale, as
   * createArtifact does by default. Incremental runs call this only after the
   * new version finishes, so a cancelled or failed rerun keeps the old one.
   */
  async supersedeArtifacts(projectID: string, artifactIDs: readonly string[]) {
    const timestamp = this.timestamp();
    for (const artifactID of artifactIDs) {
      const file = await this.getArtifact(projectID, artifactID);
      if (!file || file.artifact.status === "superseded") continue;
      await this.updateArtifact(
        projectID,
        artifactID,
        file.revision,
        (current) => ({
          ...current,
          status: "superseded",
          updatedAt: timestamp,
        }),
        false,
      );
      await this.markArtifactsStaleForArtifact({ projectID, artifactID });
    }
    await this.syncCatalogEntry(projectID);
  }

  private async pruneArtifactHistory(
    projectID: string,
    latest: ResearchWorkspaceArtifact,
  ) {
    const limit = (await this.getPreferences()).preferences
      .artifactHistoryLimit;
    const listed = await this.listArtifacts(projectID);
    const scope = [...latest.sourceIDs].sort().join("\n");
    const sameHistory = listed.artifacts.filter(
      (artifact) =>
        artifact.type === latest.type &&
        artifact.lineage.operation === latest.lineage.operation &&
        [...artifact.sourceIDs].sort().join("\n") === scope,
    );
    let excess = sameHistory.length - limit;
    if (excess <= 0) return;
    const referenced = new Set(
      listed.artifacts.flatMap((artifact) =>
        (artifact.lineage.artifactInputs ?? []).map(
          (input) => input.artifactID,
        ),
      ),
    );
    const candidates = sameHistory
      .filter(
        (artifact) =>
          artifact.status === "superseded" &&
          !referenced.has(artifact.artifactID),
      )
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt < right.createdAt ? -1 : 1;
        }
        return left.version - right.version;
      });
    for (const candidate of candidates) {
      if (excess <= 0) break;
      await this.deleteArtifact(projectID, candidate.artifactID);
      excess -= 1;
    }
  }

  async updateArtifact<T = unknown>(
    projectID: string,
    artifactID: string,
    expectedRevision: number,
    mutate: (
      artifact: ResearchWorkspaceArtifact<T>,
    ) => ResearchWorkspaceArtifact<T> | undefined,
    syncCatalog = true,
  ) {
    const timestamp = this.timestamp();
    let previousArtifact: ResearchWorkspaceArtifact<T> | undefined;
    let changed = false;
    const next = await this.files.mutate({
      path: this.getArtifactPath(projectID, artifactID),
      parser: parseResearchWorkspaceArtifactFile,
      expectedRevision,
      mutate: (file) => {
        previousArtifact = cloneResearchWorkspaceValue(
          file.artifact as ResearchWorkspaceArtifact<T>,
        );
        const artifact = mutate(
          cloneResearchWorkspaceValue(
            file.artifact as ResearchWorkspaceArtifact<T>,
          ),
        );
        if (!artifact) return undefined;
        if (
          artifact.artifactID !== artifactID ||
          artifact.projectID !== projectID
        ) {
          throw new Error("An artifact update cannot change its identity.");
        }
        if (JSON.stringify(previousArtifact) === JSON.stringify(artifact)) {
          return undefined;
        }
        artifact.updatedAt = timestamp;
        const candidate = { ...file, artifact };
        parseResearchWorkspaceArtifactFile(candidate);
        changed = true;
        return candidate;
      },
    });
    if (syncCatalog && changed) {
      await this.markArtifactsStaleForArtifact({
        projectID,
        artifactID,
      });
      await this.syncCatalogEntry(projectID);
    }
    return next as ResearchWorkspaceArtifactFile<T>;
  }

  private async markArtifactStaleConditionally(params: {
    projectID: string;
    artifactID: string;
    reason: string;
    matches: (artifact: ResearchWorkspaceArtifact) => boolean;
  }) {
    let matched = false;
    let changed = false;
    try {
      await this.files.mutate({
        path: this.getArtifactPath(params.projectID, params.artifactID),
        parser: parseResearchWorkspaceArtifactFile,
        mutate: (file) => {
          if (file.artifact.projectID !== params.projectID) {
            throw new Error(
              `Artifact ${params.artifactID} belongs to another project.`,
            );
          }
          if (!params.matches(file.artifact)) return undefined;
          if (
            file.artifact.status === "superseded" ||
            file.artifact.status === "failed"
          ) {
            return undefined;
          }
          matched = true;
          if (
            file.artifact.status === "stale" &&
            file.artifact.staleReasons?.includes(params.reason)
          ) {
            return undefined;
          }
          changed = true;
          const timestamp = this.timestamp();
          const candidate = {
            ...file,
            artifact: {
              ...file.artifact,
              status: "stale" as const,
              lastCurrentAt:
                file.artifact.lastCurrentAt ?? file.artifact.updatedAt,
              staleReasons: [
                ...new Set([
                  ...(file.artifact.staleReasons ?? []),
                  params.reason,
                ]),
              ],
              updatedAt: timestamp,
            },
          };
          parseResearchWorkspaceArtifactFile(candidate);
          return candidate;
        },
      });
    } catch (error) {
      if (
        error instanceof ResearchWorkspaceFileMissingError &&
        error.path === this.getArtifactPath(params.projectID, params.artifactID)
      ) {
        return { matched: false, changed: false };
      }
      throw error;
    }
    return { matched, changed };
  }

  private async propagateArtifactStaleness(params: {
    projectID: string;
    reason: string;
    seedArtifactIDs?: readonly string[];
    directMatch?: (artifact: ResearchWorkspaceArtifact) => boolean;
  }) {
    const seeds = new Set(params.seedArtifactIDs ?? []);
    const affected = new Set(seeds);
    const changed = new Set<string>();
    let converged = false;

    for (
      let round = 0;
      round < MAX_ARTIFACT_STALE_PROPAGATION_ROUNDS;
      round += 1
    ) {
      const before = await this.listArtifacts(params.projectID);
      const beforeSignature = artifactPropagationSignature(before.artifacts);
      const affectedAtRoundStart = affected.size;
      const ordered = [...before.artifacts].sort((left, right) =>
        left.artifactID.localeCompare(right.artifactID),
      );
      let changedThisRound = false;

      // A snapshot schedules artifact IDs only. A direct source or membership
      // match becomes an affected root only after the serialized file mutation
      // has re-read and confirmed the current lineage.
      for (const artifact of ordered) {
        if (
          seeds.has(artifact.artifactID) ||
          affected.has(artifact.artifactID) ||
          !params.directMatch
        ) {
          continue;
        }
        const result = await this.markArtifactStaleConditionally({
          projectID: params.projectID,
          artifactID: artifact.artifactID,
          reason: params.reason,
          matches: params.directMatch,
        });
        if (result.matched) affected.add(artifact.artifactID);
        if (result.changed) {
          changed.add(artifact.artifactID);
          changedThisRound = true;
        }
      }

      // Resolve the dependency closure against current file contents. Multiple
      // passes handle reverse-sorted chains in one bounded outer round; newly
      // created artifact IDs are discovered by the next outer round.
      for (let expansion = 0; expansion <= ordered.length; expansion += 1) {
        let expanded = false;
        for (const artifact of ordered) {
          if (
            seeds.has(artifact.artifactID) ||
            affected.has(artifact.artifactID)
          ) {
            continue;
          }
          const result = await this.markArtifactStaleConditionally({
            projectID: params.projectID,
            artifactID: artifact.artifactID,
            reason: params.reason,
            matches: (current) =>
              Boolean(
                current.lineage.artifactInputs?.some((input) =>
                  affected.has(input.artifactID),
                ),
              ),
          });
          if (!result.matched) continue;
          affected.add(artifact.artifactID);
          expanded = true;
          if (result.changed) {
            changed.add(artifact.artifactID);
            changedThisRound = true;
          }
        }
        if (!expanded) break;
      }

      const after = await this.listArtifacts(params.projectID);
      const afterSignature = artifactPropagationSignature(after.artifacts);
      if (
        !changedThisRound &&
        affected.size === affectedAtRoundStart &&
        beforeSignature === afterSignature
      ) {
        converged = true;
        break;
      }
    }

    if (changed.size) await this.syncCatalogEntry(params.projectID);
    if (!converged) {
      throw new Error(
        `Artifact stale propagation for project ${params.projectID} did not converge within ${MAX_ARTIFACT_STALE_PROPAGATION_ROUNDS} rounds.`,
      );
    }
    return [...changed].sort();
  }

  async markArtifactStaleAtomically(params: {
    projectID: string;
    artifactID: string;
    reason: string;
  }) {
    const changed = await this.propagateArtifactStaleness({
      projectID: params.projectID,
      reason: params.reason,
      directMatch: (artifact) => artifact.artifactID === params.artifactID,
    });
    return this.getArtifact(params.projectID, params.artifactID).then(
      (file) => ({
        file,
        changed: changed.includes(params.artifactID),
      }),
    );
  }

  async ensureArtifactReference(projectID: string, artifactID: string) {
    const [bundle, artifact] = await Promise.all([
      this.getProject(projectID),
      this.getArtifact(projectID, artifactID),
    ]);
    if (!artifact) {
      throw new ResearchWorkspaceNotFoundError("Artifact", artifactID);
    }
    if (bundle.project.artifactIDs.includes(artifactID)) return bundle;
    await this.files.mutate({
      path: this.getProjectPath(projectID),
      parser: parseResearchWorkspaceProjectFile,
      expectedRevision: bundle.projectRevision,
      mutate: (file) => ({
        ...file,
        project: {
          ...file.project,
          artifactIDs: [...file.project.artifactIDs, artifactID],
          activeArtifactID: artifactID,
          updatedAt: this.timestamp(),
        },
      }),
    });
    await this.syncCatalogEntry(projectID);
    return this.getProject(projectID);
  }

  async markArtifactsStaleForSource(params: {
    projectID: string;
    sourceID: string;
    contentFingerprint: string;
    reason?: string;
  }) {
    const reason = params.reason ?? `source-content-changed:${params.sourceID}`;
    return this.propagateArtifactStaleness({
      projectID: params.projectID,
      reason,
      directMatch: (artifact) => {
        const input = artifact.lineage.inputs.find(
          (entry) => entry.sourceID === params.sourceID,
        );
        return Boolean(
          input && input.contentFingerprint !== params.contentFingerprint,
        );
      },
    });
  }

  async markArtifactsStaleForArtifact(params: {
    projectID: string;
    artifactID: string;
    reason?: string;
  }) {
    const reason =
      params.reason ?? `upstream-artifact-changed:${params.artifactID}`;
    return this.propagateArtifactStaleness({
      projectID: params.projectID,
      reason,
      seedArtifactIDs: [params.artifactID],
    });
  }

  async markArtifactsStaleForMembersRevision(params: {
    projectID: string;
    membersRevision: number;
    reason?: string;
  }) {
    const reason = params.reason ?? "project-source-scope-changed";
    const bundle = await this.getProject(params.projectID);
    return this.propagateArtifactStaleness({
      projectID: params.projectID,
      reason,
      directMatch: (artifact) =>
        artifact.lineage.scopeFingerprint !== undefined
          ? artifact.lineage.scopeFingerprint !==
            projectScopeFingerprint(bundle, artifact.sourceIDs)
          : artifact.lineage.membersRevision !== undefined &&
            artifact.lineage.membersRevision !== params.membersRevision,
    });
  }

  async deleteArtifact(projectID: string, artifactID: string) {
    const bundle = await this.getProject(projectID);
    const file = await this.getArtifact(projectID, artifactID);
    if (!file) throw new ResearchWorkspaceNotFoundError("Artifact", artifactID);
    await this.markArtifactsStaleForArtifact({
      projectID,
      artifactID,
      reason: `upstream-artifact-deleted:${artifactID}`,
    });
    await this.files.mutate({
      path: this.getProjectPath(projectID),
      parser: parseResearchWorkspaceProjectFile,
      expectedRevision: bundle.projectRevision,
      mutate: (projectFile) => ({
        ...projectFile,
        project: {
          ...projectFile.project,
          artifactIDs: projectFile.project.artifactIDs.filter(
            (id) => id !== artifactID,
          ),
          ...(projectFile.project.activeArtifactID === artifactID
            ? { activeArtifactID: undefined }
            : {}),
          updatedAt: this.timestamp(),
        },
      }),
    });
    await this.files.remove(this.getArtifactPath(projectID, artifactID));
    await this.syncCatalogEntry(projectID);
  }

  async createRun(projectID: string, input: CreateResearchWorkspaceRunInput) {
    const bundle = await this.getProject(projectID);
    const runID = assertResearchWorkspaceID(
      input.runID ?? this.idFactory("run"),
      "runID",
    );
    const timestamp = this.timestamp();
    const run: ResearchWorkspaceRun = {
      ...cloneResearchWorkspaceValue(input),
      runID,
      projectID,
      updatedAt: timestamp,
    };
    if (run.owner.kind === "project" && run.owner.projectID !== projectID) {
      throw new Error("A project run owner must match its projectID.");
    }
    await this.files.ensureDirectory(
      joinPath(this.getProjectRoot(projectID), "runs"),
    );
    const created = await this.files.writeNew(
      this.getRunPath(projectID, runID),
      {
        schemaVersion: RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION,
        revision: 0,
        run,
      },
    );
    await this.files.mutate({
      path: this.getProjectPath(projectID),
      parser: parseResearchWorkspaceProjectFile,
      expectedRevision: bundle.projectRevision,
      mutate: (file) => ({
        ...file,
        project: {
          ...file.project,
          runIDs: [...file.project.runIDs, runID],
          updatedAt: timestamp,
        },
      }),
    });
    await this.syncCatalogEntry(projectID);
    return created;
  }

  async getRun(projectID: string, runID: string) {
    const file = await this.files.read(
      this.getRunPath(projectID, runID),
      parseResearchWorkspaceRunFile,
    );
    if (file?.run.projectID && file.run.projectID !== projectID) {
      throw new Error(`Run ${runID} belongs to another project.`);
    }
    return file;
  }

  async listRuns(projectID: string): Promise<ResearchWorkspaceRunList> {
    const bundle = await this.getProject(projectID);
    const runs: ResearchWorkspaceRun[] = [];
    const warnings: string[] = [];
    for (const runID of bundle.project.runIDs) {
      try {
        const file = await this.getRun(projectID, runID);
        if (file) runs.push(file.run);
        else warnings.push(`Run ${runID} is missing.`);
      } catch (error) {
        warnings.push(
          `Run ${runID} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { runs, warnings };
  }

  async updateRun(
    projectID: string,
    runID: string,
    expectedRevision: number,
    mutate: (run: ResearchWorkspaceRun) => ResearchWorkspaceRun,
  ) {
    const timestamp = this.timestamp();
    return this.files.mutate({
      path: this.getRunPath(projectID, runID),
      parser: parseResearchWorkspaceRunFile,
      expectedRevision,
      mutate: (file) => {
        const run = mutate(cloneResearchWorkspaceValue(file.run));
        if (run.runID !== runID || run.projectID !== projectID) {
          throw new Error("A run update cannot change its identity.");
        }
        if (run.owner.kind === "project" && run.owner.projectID !== projectID) {
          throw new Error("A project run owner must match its projectID.");
        }
        run.updatedAt = timestamp;
        const candidate = { ...file, run };
        parseResearchWorkspaceRunFile(candidate);
        return candidate;
      },
    });
  }

  async recoverInterruptedRuns() {
    const recovered: string[] = [];
    const warnings: string[] = [];
    const projects = await this.listProjects({ includeArchived: true });
    for (const project of projects) {
      const listed = await this.listRuns(project.projectID);
      warnings.push(...listed.warnings);
      for (const run of listed.runs) {
        if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
        const file = await this.getRun(project.projectID, run.runID);
        if (!file) continue;
        await this.updateRun(
          project.projectID,
          run.runID,
          file.revision,
          (current) => ({
            ...current,
            status: "interrupted",
            safeError: "Paper Pilot restarted before this run completed.",
            completedAt: this.timestamp(),
          }),
        );
        recovered.push(run.runID);
      }
    }
    return { recovered, warnings };
  }

  private async quarantineProjectFile(path: string, projectID: string) {
    const quarantineRoot = joinPath(
      this.getProjectRoot(projectID),
      "quarantine",
    );
    await this.files.ensureDirectory(quarantineRoot);
    const quarantinePath = joinPath(
      quarantineRoot,
      `${fileName(path)}.corrupt-${this.timestamp().replace(/[^0-9TZ]/g, "-")}`,
    );
    return this.files.quarantine(path, quarantinePath);
  }

  private async repairProjectReferences(projectID: string) {
    const bundle = await this.getProject(projectID);
    const warnings: string[] = [];
    const artifactIDs: string[] = [];
    const runIDs: string[] = [];
    const artifactPaths = (
      await this.files.listDirectory(
        joinPath(this.getProjectRoot(projectID), "artifacts"),
      )
    )
      .filter((path) => /[\\/]artifact-[^\\/]+\.json$/i.test(path))
      .sort();
    for (const path of artifactPaths) {
      try {
        const file = await this.files.read(
          path,
          parseResearchWorkspaceArtifactFile,
        );
        if (!file) continue;
        if (
          file.artifact.projectID !== projectID ||
          this.getArtifactPath(projectID, file.artifact.artifactID) !== path
        ) {
          throw new Error("artifact identity does not match its path");
        }
        artifactIDs.push(file.artifact.artifactID);
      } catch (error) {
        const quarantined = await this.quarantineProjectFile(path, projectID);
        warnings.push(
          `Artifact file ${path} was ${
            quarantined ? "quarantined" : "left in place"
          }: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const runPaths = (
      await this.files.listDirectory(
        joinPath(this.getProjectRoot(projectID), "runs"),
      )
    )
      .filter((path) => /[\\/]run-[^\\/]+\.json$/i.test(path))
      .sort();
    for (const path of runPaths) {
      try {
        const file = await this.files.read(path, parseResearchWorkspaceRunFile);
        if (!file) continue;
        if (
          (file.run.projectID && file.run.projectID !== projectID) ||
          this.getRunPath(projectID, file.run.runID) !== path
        ) {
          throw new Error("run identity does not match its path");
        }
        runIDs.push(file.run.runID);
      } catch (error) {
        const quarantined = await this.quarantineProjectFile(path, projectID);
        warnings.push(
          `Run file ${path} was ${
            quarantined ? "quarantined" : "left in place"
          }: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const validArtifacts = new Set(artifactIDs);
    const validRuns = new Set(runIDs);
    const nextArtifactIDs = [
      ...bundle.project.artifactIDs.filter((id) => validArtifacts.has(id)),
      ...artifactIDs.filter((id) => !bundle.project.artifactIDs.includes(id)),
    ];
    const nextRunIDs = [
      ...bundle.project.runIDs.filter((id) => validRuns.has(id)),
      ...runIDs.filter((id) => !bundle.project.runIDs.includes(id)),
    ];
    const activeArtifactID =
      bundle.project.activeArtifactID &&
      validArtifacts.has(bundle.project.activeArtifactID)
        ? bundle.project.activeArtifactID
        : nextArtifactIDs.at(-1);
    const changed =
      JSON.stringify(nextArtifactIDs) !==
        JSON.stringify(bundle.project.artifactIDs) ||
      JSON.stringify(nextRunIDs) !== JSON.stringify(bundle.project.runIDs) ||
      activeArtifactID !== bundle.project.activeArtifactID;
    if (changed) {
      await this.files.mutate({
        path: this.getProjectPath(projectID),
        parser: parseResearchWorkspaceProjectFile,
        expectedRevision: bundle.projectRevision,
        mutate: (file) => ({
          ...file,
          project: {
            ...file.project,
            artifactIDs: nextArtifactIDs,
            runIDs: nextRunIDs,
            ...(activeArtifactID
              ? { activeArtifactID }
              : { activeArtifactID: undefined }),
            updatedAt: this.timestamp(),
          },
        }),
      });
    }
    return { changed, warnings };
  }

  async recoverStartup() {
    const warnings: string[] = [];
    let repairedCatalog = false;
    const repositoryPaths = await this.files.listDirectory(this.rootDir);
    // Only the exact names storage.writeTextAtomic creates, and never the
    // user-facing exports, whose names come from project names.
    const exportsRoot = `${joinPath(this.rootDir, "exports")}/`;
    const temporaryPaths = repositoryPaths.filter(
      (path) =>
        /\.tmp-\d+-[a-z0-9]*$/.test(path) && !path.startsWith(exportsRoot),
    );
    for (const path of temporaryPaths) {
      try {
        await this.files.remove(path);
      } catch (error) {
        warnings.push(
          `Temporary file ${path} could not be removed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const projectPaths = repositoryPaths.filter((path) =>
      path.startsWith(`${this.projectsRoot}/`),
    );
    if (
      (await this.hasCatalog()) ||
      projectPaths.some((path) => /[\\/]project\.json$/i.test(path))
    ) {
      const repair = await this.repairCatalog();
      repairedCatalog = repair.changed;
      warnings.push(...repair.warnings);
    }
    for (const project of await this.listProjects({ includeArchived: true })) {
      try {
        await this.recoverCandidateMembers(project.projectID);
      } catch (error) {
        warnings.push(
          `Candidate inbox recovery failed for ${project.projectID}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const runs = await this.recoverInterruptedRuns();
    warnings.push(...runs.warnings);
    return {
      repairedCatalog,
      interruptedRunIDs: runs.recovered,
      warnings,
    };
  }

  async exportProject(
    projectID: string,
  ): Promise<ResearchWorkspacePortableExport> {
    const bundle = await this.getProject(projectID);
    const [artifactList, runList] = await Promise.all([
      this.listArtifacts(projectID),
      this.listRuns(projectID),
    ]);
    const sources: ResearchWorkspaceSourceRecord[] = [];
    const warnings = [...artifactList.warnings, ...runList.warnings];
    for (const member of bundle.members) {
      try {
        const source = await this.getSource(member.sourceID);
        if (source) sources.push(source.source);
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
      schemaVersion: 1,
      exportedAt: this.timestamp(),
      project: bundle.project,
      members: bundle.members,
      candidates: (await this.getCandidates(projectID)).candidates,
      sources,
      artifacts: artifactList.artifacts,
      runs: runList.runs,
      warnings,
    };
  }

  async repairCatalog() {
    const paths = await this.files.listDirectory(this.projectsRoot);
    const projectPaths = paths.filter((path) =>
      /[\\/]project\.json$/i.test(path),
    );
    const projects: ResearchWorkspaceCatalogEntry[] = [];
    const warnings: string[] = [];
    // A failed deletion can leave only this record. Keep its catalog action
    // available after restart instead of silently hiding the remaining files.
    for (const path of await this.files.listDirectory(
      joinPath(this.rootDir, "deletions"),
    )) {
      if (!/[\\/]project-[^\\/]+\.json$/.test(path)) continue;
      try {
        const intent = await this.files.read(path, parseProjectDeletionIntent);
        if (!intent || path !== this.getDeletionPath(intent.entry.projectID))
          continue;
        await this.files.freezeDirectories(
          getResearchWorkspaceProjectOwnedDirectories(
            this.rootDir,
            intent.entry.projectID,
          ),
        );
        projects.push(intent.entry);
        warnings.push(
          `Project ${intent.entry.name} has unfinished cleanup. Use Delete project again to retry.`,
        );
      } catch (error) {
        warnings.push(
          `Project deletion record ${path} could not be recovered: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    let repairedProjectReferences = false;
    for (const path of projectPaths) {
      try {
        const file = await this.files.read(
          path,
          parseResearchWorkspaceProjectFile,
        );
        if (!file) continue;
        // A copied project directory repeats another project's ID. Index
        // only the file at its own path, once, so the catalog stays valid.
        if (this.getProjectPath(file.project.projectID) !== path) {
          warnings.push(
            `Project file ${path} was skipped because its ID belongs to another directory.`,
          );
          continue;
        }
        if (
          projects.some((entry) => entry.projectID === file.project.projectID)
        ) {
          continue;
        }
        const repaired = await this.repairProjectReferences(
          file.project.projectID,
        );
        repairedProjectReferences ||= repaired.changed;
        warnings.push(...repaired.warnings);
        projects.push(await this.catalogEntry(file.project.projectID));
      } catch (error) {
        warnings.push(
          `Project at ${path} could not be indexed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const sortedProjects = sortCatalogProjects(projects);
    let revision = 1;
    let createdAt = this.timestamp();
    let current: ResearchWorkspaceCatalog | undefined;
    try {
      current = await this.getCatalog();
      revision = current.revision + 1;
      createdAt = current.createdAt;
    } catch {
      // A corrupt catalog is replaceable because project files are authoritative.
    }
    if (
      current &&
      JSON.stringify(current.projects) === JSON.stringify(sortedProjects)
    ) {
      return {
        catalog: current,
        warnings,
        changed: repairedProjectReferences,
      };
    }
    const catalog: ResearchWorkspaceCatalog = {
      schemaVersion: RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
      revision,
      projects: sortedProjects,
      createdAt,
      updatedAt: this.timestamp(),
    };
    await this.files.ensureDirectory(this.rootDir);
    await this.files.replace(this.catalogPath, catalog);
    return { catalog, warnings, changed: true };
  }

  async pruneDerivedCache() {
    if (await this.files.exists(this.cacheRoot)) {
      await this.files.remove(this.cacheRoot, { recursive: true });
    }
  }
}
