import {
  RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION,
  ResearchWorkspaceNotFoundError,
  assertResearchWorkspaceID,
  assertResearchWorkspaceMember,
  type ResearchProject,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceArtifactFile,
  type ResearchWorkspaceArtifactList,
  type ResearchWorkspaceCatalog,
  type ResearchWorkspaceCatalogEntry,
  type ResearchWorkspaceMembersFile,
  type ResearchWorkspacePortableExport,
  type ResearchWorkspaceProjectBundle,
  type ResearchWorkspaceProjectFile,
  type ResearchWorkspaceProjectMember,
  type ResearchWorkspacePreferences,
  type ResearchWorkspaceRepositoryOptions,
  type ResearchWorkspaceRun,
  type ResearchWorkspaceRunFile,
  type ResearchWorkspaceRunList,
  type ResearchWorkspaceSourceFile,
  type ResearchWorkspaceSourceRecord,
} from "./contracts";
import {
  cloneResearchWorkspaceValue,
  SerializedResearchWorkspaceFiles,
} from "./fileStore";
import {
  parseResearchWorkspaceArtifactFile,
  parseResearchWorkspaceCatalog,
  parseResearchWorkspaceMembersFile,
  parseResearchWorkspaceProjectFile,
  parseResearchWorkspacePreferencesFile,
  parseResearchWorkspaceRunFile,
  parseResearchWorkspaceSourceFile,
} from "./validation";

function joinPath(...parts: string[]) {
  const separator = parts.some((part) => part.includes("\\")) ? "\\" : "/";
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/g, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .filter(Boolean)
    .join(separator);
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

function emptyCatalog(now: string): ResearchWorkspaceCatalog {
  return {
    schemaVersion: RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
    revision: 0,
    projects: [],
    createdAt: now,
    updatedAt: now,
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
      retainRawRunLogs: false,
    },
    createdAt: now,
    updatedAt: now,
  } as const;
}

function stableHash(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
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

export class ResearchWorkspaceProjectRepository {
  private readonly files: SerializedResearchWorkspaceFiles;
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: ResearchWorkspaceRepositoryOptions) {
    this.rootDir = options.rootDir;
    this.files = new SerializedResearchWorkspaceFiles(options.fileOps);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultID;
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
    return joinPath(
      this.projectsRoot,
      `project-${assertResearchWorkspaceID(projectID, "projectID")}`,
    );
  }

  getProjectPath(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "project.json");
  }

  getMembersPath(projectID: string) {
    return joinPath(this.getProjectRoot(projectID), "members.json");
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

  async listProjects(options: { includeArchived?: boolean } = {}) {
    const catalog = await this.getCatalog();
    return catalog.projects.filter(
      (entry) => options.includeArchived || !entry.archivedAt,
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
    } satisfies ResearchWorkspaceCatalogEntry;
  }

  private async syncCatalogEntry(projectID: string) {
    const entry = await this.catalogEntry(projectID);
    await this.updateCatalog((catalog) => ({
      ...catalog,
      projects: [
        ...catalog.projects.filter((item) => item.projectID !== projectID),
        entry,
      ],
    }));
  }

  async createProject(input: CreateResearchWorkspaceProjectInput) {
    const name = input.name.trim();
    if (!name) throw new Error("Project name is required.");
    const projectID = assertResearchWorkspaceID(
      input.projectID ?? this.idFactory("project"),
      "projectID",
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
    if (!membersFile) {
      throw new Error(`Project ${projectID} is missing members.json.`);
    }
    if (membersFile.projectID !== projectID) {
      throw new Error(
        `Project ${projectID} members are bound to another project.`,
      );
    }
    return {
      project: projectFile.project,
      projectRevision: projectFile.revision,
      members: membersFile.members,
      membersRevision: membersFile.revision,
    };
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

  async deleteProject(projectID: string) {
    await this.getProject(projectID);
    await this.files.remove(this.getProjectRoot(projectID), {
      recursive: true,
    });
    await this.updateCatalog((catalog) => ({
      ...catalog,
      projects: catalog.projects.filter(
        (entry) => entry.projectID !== projectID,
      ),
    }));
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
    const history = await this.listArtifacts(projectID);
    const inputScope = [...input.sourceIDs].sort().join("\n");
    const sameType = history.artifacts.filter(
      (artifact) =>
        artifact.type === input.type &&
        [...artifact.sourceIDs].sort().join("\n") === inputScope &&
        artifact.lineage.operation === input.lineage.operation,
    );
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
    const created = await this.files.writeNew(
      this.getArtifactPath(projectID, artifactID),
      {
        schemaVersion: RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
        revision: 0,
        artifact,
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
          artifactIDs: [...file.project.artifactIDs, artifactID],
          activeArtifactID: artifactID,
          updatedAt: timestamp,
        },
      }),
    });
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
    await this.syncCatalogEntry(projectID);
    return created;
  }

  async updateArtifact<T = unknown>(
    projectID: string,
    artifactID: string,
    expectedRevision: number,
    mutate: (
      artifact: ResearchWorkspaceArtifact<T>,
    ) => ResearchWorkspaceArtifact<T>,
    syncCatalog = true,
  ) {
    const timestamp = this.timestamp();
    let previousArtifact: ResearchWorkspaceArtifact<T> | undefined;
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
        if (
          artifact.artifactID !== artifactID ||
          artifact.projectID !== projectID
        ) {
          throw new Error("An artifact update cannot change its identity.");
        }
        artifact.updatedAt = timestamp;
        const candidate = { ...file, artifact };
        parseResearchWorkspaceArtifactFile(candidate);
        return candidate;
      },
    });
    if (syncCatalog) {
      const changed =
        !previousArtifact ||
        JSON.stringify(previousArtifact) !== JSON.stringify(next.artifact);
      if (changed) {
        await this.markArtifactsStaleForArtifact({
          projectID,
          artifactID,
        });
      }
      await this.syncCatalogEntry(projectID);
    }
    return next as ResearchWorkspaceArtifactFile<T>;
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
    const listed = await this.listArtifacts(params.projectID);
    const changed: string[] = [];
    for (const artifact of listed.artifacts) {
      const input = artifact.lineage.inputs.find(
        (entry) => entry.sourceID === params.sourceID,
      );
      if (
        !input ||
        input.contentFingerprint === params.contentFingerprint ||
        artifact.status === "superseded"
      ) {
        continue;
      }
      const file = await this.getArtifact(
        params.projectID,
        artifact.artifactID,
      );
      const currentInput = file?.artifact.lineage.inputs.find(
        (entry) => entry.sourceID === params.sourceID,
      );
      const reason =
        params.reason ?? `source-content-changed:${params.sourceID}`;
      if (
        !file ||
        !currentInput ||
        currentInput.contentFingerprint === params.contentFingerprint ||
        file.artifact.status === "superseded" ||
        file.artifact.status === "failed" ||
        (file.artifact.status === "stale" &&
          file.artifact.staleReasons?.includes(reason))
      ) {
        continue;
      }
      await this.updateArtifact(
        params.projectID,
        artifact.artifactID,
        file.revision,
        (current) => ({
          ...current,
          status: "stale",
          lastCurrentAt: current.lastCurrentAt ?? current.updatedAt,
          staleReasons: [...new Set([...(current.staleReasons ?? []), reason])],
        }),
        false,
      );
      changed.push(artifact.artifactID);
    }
    if (changed.length) await this.syncCatalogEntry(params.projectID);
    return changed;
  }

  async markArtifactsStaleForArtifact(params: {
    projectID: string;
    artifactID: string;
    reason?: string;
  }) {
    const listed = await this.listArtifacts(params.projectID);
    const changed: string[] = [];
    const reason =
      params.reason ?? `upstream-artifact-changed:${params.artifactID}`;
    const queue = [params.artifactID];
    const visited = new Set<string>();
    while (queue.length) {
      const upstreamArtifactID = queue.shift()!;
      if (visited.has(upstreamArtifactID)) continue;
      visited.add(upstreamArtifactID);
      const dependents = listed.artifacts
        .filter(
          (artifact) =>
            !visited.has(artifact.artifactID) &&
            artifact.lineage.artifactInputs?.some(
              (input) => input.artifactID === upstreamArtifactID,
            ),
        )
        .sort((left, right) => left.artifactID.localeCompare(right.artifactID));
      for (const dependent of dependents) {
        queue.push(dependent.artifactID);
        const file = await this.getArtifact(
          params.projectID,
          dependent.artifactID,
        );
        if (
          !file ||
          file.artifact.status === "superseded" ||
          file.artifact.status === "failed" ||
          !file.artifact.lineage.artifactInputs?.some(
            (input) => input.artifactID === upstreamArtifactID,
          ) ||
          (file.artifact.status === "stale" &&
            file.artifact.staleReasons?.includes(reason))
        ) {
          continue;
        }
        await this.updateArtifact(
          params.projectID,
          dependent.artifactID,
          file.revision,
          (current) => ({
            ...current,
            status: "stale",
            lastCurrentAt: current.lastCurrentAt ?? current.updatedAt,
            staleReasons: [
              ...new Set([...(current.staleReasons ?? []), reason]),
            ],
          }),
          false,
        );
        changed.push(dependent.artifactID);
      }
    }
    if (changed.length) await this.syncCatalogEntry(params.projectID);
    return changed.sort();
  }

  async markArtifactsStaleForMembersRevision(params: {
    projectID: string;
    membersRevision: number;
    reason?: string;
  }) {
    const listed = await this.listArtifacts(params.projectID);
    const changed: string[] = [];
    const reason = params.reason ?? "project-source-scope-changed";
    for (const artifact of listed.artifacts) {
      if (
        artifact.status === "superseded" ||
        artifact.status === "failed" ||
        artifact.lineage.membersRevision === undefined ||
        artifact.lineage.membersRevision === params.membersRevision ||
        (artifact.status === "stale" && artifact.staleReasons?.includes(reason))
      ) {
        continue;
      }
      const file = await this.getArtifact(
        params.projectID,
        artifact.artifactID,
      );
      if (
        !file ||
        file.artifact.status === "superseded" ||
        file.artifact.status === "failed" ||
        file.artifact.lineage.membersRevision === undefined ||
        file.artifact.lineage.membersRevision === params.membersRevision ||
        (file.artifact.status === "stale" &&
          file.artifact.staleReasons?.includes(reason))
      ) {
        continue;
      }
      await this.updateArtifact(
        params.projectID,
        artifact.artifactID,
        file.revision,
        (current) => ({
          ...current,
          status: "stale",
          lastCurrentAt: current.lastCurrentAt ?? current.updatedAt,
          staleReasons: [...new Set([...(current.staleReasons ?? []), reason])],
        }),
        false,
      );
      changed.push(artifact.artifactID);
    }
    if (changed.length) await this.syncCatalogEntry(params.projectID);
    return changed;
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
    await this.files.remove(this.getArtifactPath(projectID, artifactID));
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

  async recoverStartup() {
    const warnings: string[] = [];
    let repairedCatalog = false;
    let needsRepair = false;
    try {
      if (await this.hasCatalog()) await this.getCatalog();
      else {
        const paths = await this.files.listDirectory(this.projectsRoot);
        needsRepair = paths.some((path) => /[\\/]project\.json$/i.test(path));
      }
    } catch (error) {
      needsRepair = true;
      warnings.push(
        `Catalog validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (needsRepair) {
      const repair = await this.repairCatalog();
      repairedCatalog = true;
      warnings.push(...repair.warnings);
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
    for (const path of projectPaths) {
      try {
        const file = await this.files.read(
          path,
          parseResearchWorkspaceProjectFile,
        );
        if (!file) continue;
        projects.push(await this.catalogEntry(file.project.projectID));
      } catch (error) {
        warnings.push(
          `Project at ${path} could not be indexed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    let revision = 1;
    let createdAt = this.timestamp();
    try {
      const current = await this.getCatalog();
      revision = current.revision + 1;
      createdAt = current.createdAt;
    } catch {
      // A corrupt catalog is replaceable because project files are authoritative.
    }
    const catalog: ResearchWorkspaceCatalog = {
      schemaVersion: RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
      revision,
      projects: sortCatalogProjects(projects),
      createdAt,
      updatedAt: this.timestamp(),
    };
    await this.files.ensureDirectory(this.rootDir);
    await this.files.replace(this.catalogPath, catalog);
    return { catalog, warnings };
  }

  async pruneDerivedCache() {
    if (await this.files.exists(this.cacheRoot)) {
      await this.files.remove(this.cacheRoot, { recursive: true });
    }
  }
}
