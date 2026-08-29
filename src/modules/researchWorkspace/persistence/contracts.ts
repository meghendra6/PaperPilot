export const RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const RESEARCH_WORKSPACE_MIGRATION_SCHEMA_VERSION = 1 as const;

export type ResearchWorkspaceEngineMode =
  | "codex_cli"
  | "claude_code"
  | "gemini_cli";

export interface ResearchWorkspaceContentFingerprint {
  algorithm: "sha256" | "zotero-version-mtime-size-v1";
  value: string;
  fileSize?: number;
  modifiedTime?: number;
  zoteroVersion?: number;
}

export interface ResearchWorkspaceExtractionFingerprint {
  contentFingerprint: ResearchWorkspaceContentFingerprint;
  extractor: "opendataloader-pdf" | "zotero-attachment-text";
  extractorVersion: string;
  extractionOptionsVersion: string;
}

export interface ResearchWorkspaceCriterion {
  criterionID: string;
  text: string;
  enabled: boolean;
  createdBy: "user" | "suggested";
  acceptedAt?: string;
}

export interface ResearchWorkspaceProjectScope {
  pico?: {
    population?: string;
    intervention?: string;
    comparison?: string;
    outcome?: string;
  };
  inclusionCriteria: ResearchWorkspaceCriterion[];
  exclusionCriteria: ResearchWorkspaceCriterion[];
}

export interface ResearchProject {
  projectID: string;
  name: string;
  description?: string;
  researchQuestion?: string;
  scope?: ResearchWorkspaceProjectScope;
  defaultEngineMode?: ResearchWorkspaceEngineMode;
  activeArtifactID?: string;
  artifactIDs: string[];
  runIDs: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export type ResearchWorkspaceMemberRole =
  | "seed"
  | "candidate"
  | "background"
  | "comparison"
  | "included";

export type ResearchWorkspaceReviewStatus =
  | "unreviewed"
  | "maybe"
  | "up-next"
  | "skimmed"
  | "read"
  | "understood"
  | "included"
  | "excluded";

export interface ResearchWorkspaceProjectMember {
  sourceID: string;
  role: ResearchWorkspaceMemberRole;
  reviewStatus: ResearchWorkspaceReviewStatus;
  exclusionReason?: string;
  addedAt: string;
  updatedAt: string;
  userNote?: string;
}

export interface ResearchWorkspaceSourceRecord {
  sourceID: string;
  identity: {
    libraryID: number;
    itemKey: string;
    attachmentKey: string;
    standaloneAttachment: boolean;
  };
  title: string;
  creators?: string[];
  year?: number;
  doi?: string;
  runtimeItemID?: number;
  runtimeAttachmentID?: number;
  contentFingerprint?: ResearchWorkspaceContentFingerprint;
  extractionFingerprint?: ResearchWorkspaceExtractionFingerprint;
  extractionQuality: "structured" | "zotero_text" | "unavailable";
  extractionNotes: string[];
  availability: "ready" | "missing-file" | "unreadable" | "detached";
  lastResolvedAt: string;
  lastExtractedAt?: string;
  legacyIdentity?: {
    paperKey?: string;
    attachmentKey?: string;
    resolution: "resolved" | "detached" | "ambiguous";
  };
}

export type ResearchWorkspaceArtifactType =
  | "claim-ledger"
  | "critical-read"
  | "methodology-audit"
  | "paper-mastery"
  | "reproducibility"
  | "paper-to-code"
  | "evidence-matrix"
  | "relationship-graph"
  | "cross-paper-mastery"
  | "citation-stance"
  | "synthesis"
  | "review-log";

export type ResearchWorkspaceArtifactStatus =
  | "draft"
  | "partial"
  | "complete"
  | "failed"
  | "stale"
  | "superseded";

export interface ResearchWorkspaceArtifactLineage {
  inputs: Array<{
    sourceID: string;
    contentFingerprint: string;
    contextProjectionFingerprint: string;
  }>;
  operation: string;
  operationVersion: string;
  promptVersion: string;
  parserVersion: string;
  schemaVersion?: string;
  evidenceVerifierVersion: string;
  providerMode: ResearchWorkspaceEngineMode | "unknown";
  model?: string;
  runID: string;
}

export interface ResearchWorkspaceArtifactCheckpoint {
  completedUnits: string[];
  failedUnits: Array<{ unitID: string; message: string }>;
  pendingUnits: string[];
  lastCheckpointAt: string;
}

export interface ResearchWorkspaceArtifact<T = unknown> {
  artifactID: string;
  projectID: string;
  type: ResearchWorkspaceArtifactType;
  title: string;
  version: number;
  status: ResearchWorkspaceArtifactStatus;
  sourceIDs: string[];
  lineage: ResearchWorkspaceArtifactLineage;
  payload: T;
  checkpoint?: ResearchWorkspaceArtifactCheckpoint;
  staleReasons?: string[];
  lastCurrentAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  supersedesArtifactID?: string;
}

export type ResearchWorkspaceRunOwner =
  | { kind: "paper"; itemID: number; sourceID: string }
  | { kind: "project"; projectID: string };

export type ResearchWorkspaceRunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "cancelling"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ResearchWorkspaceRun {
  runID: string;
  owner: ResearchWorkspaceRunOwner;
  projectID?: string;
  operation: string;
  operationVersion: string;
  sourceSnapshot: Array<{
    sourceID: string;
    contentFingerprint: string;
  }>;
  status: ResearchWorkspaceRunStatus;
  progress: {
    phase: string;
    completed: number;
    total?: number;
    currentUnit?: string;
  };
  artifactID?: string;
  safeError?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ResearchWorkspaceCatalogEntry {
  projectID: string;
  name: string;
  updatedAt: string;
  archivedAt?: string;
  memberCount: number;
  staleArtifactCount: number;
}

export interface ResearchWorkspaceCatalog {
  schemaVersion: typeof RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION;
  revision: number;
  projects: ResearchWorkspaceCatalogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchWorkspaceProjectFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION;
  revision: number;
  project: ResearchProject;
}

export interface ResearchWorkspaceMembersFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION;
  revision: number;
  projectID: string;
  members: ResearchWorkspaceProjectMember[];
}

export interface ResearchWorkspaceSourceFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION;
  revision: number;
  source: ResearchWorkspaceSourceRecord;
}

export interface ResearchWorkspaceArtifactFile<T = unknown> {
  schemaVersion: typeof RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION;
  revision: number;
  artifact: ResearchWorkspaceArtifact<T>;
}

export interface ResearchWorkspaceRunFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION;
  revision: number;
  run: ResearchWorkspaceRun;
}

export interface ResearchWorkspacePreferences {
  responseLanguage: "English" | "Korean" | "Chinese";
  maxPaperCharacters: number;
  artifactHistoryLimit: number;
  retainRawRunLogs: boolean;
}

export interface ResearchWorkspacePreferencesFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION;
  revision: number;
  preferences: ResearchWorkspacePreferences;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchWorkspaceLegacyMigrationSummary {
  migratedSources: number;
  skippedSources: number;
  detachedSources: number;
  ambiguousSources: number;
  artifactCounts: Record<string, number>;
  warnings: string[];
}

export interface ResearchWorkspaceLegacyMigrationMarker {
  importerVersion: string;
  status: "in-progress" | "completed";
  legacyPath: string;
  legacyFingerprint: {
    algorithm: "sha256" | "fnv1a-128-fallback";
    value: string;
  };
  startedAt: string;
  completedAt?: string;
  createdProjectID: string;
  summary: ResearchWorkspaceLegacyMigrationSummary;
}

export interface ResearchWorkspaceLegacyMigrationFile {
  schemaVersion: typeof RESEARCH_WORKSPACE_MIGRATION_SCHEMA_VERSION;
  revision: number;
  migration: ResearchWorkspaceLegacyMigrationMarker;
}

export interface ResearchWorkspaceProjectBundle {
  project: ResearchProject;
  projectRevision: number;
  members: ResearchWorkspaceProjectMember[];
  membersRevision: number;
}

export interface ResearchWorkspaceArtifactList {
  artifacts: ResearchWorkspaceArtifact[];
  warnings: string[];
}

export interface ResearchWorkspaceRunList {
  runs: ResearchWorkspaceRun[];
  warnings: string[];
}

export interface ResearchWorkspacePortableExport {
  schemaVersion: 1;
  exportedAt: string;
  project: ResearchProject;
  members: ResearchWorkspaceProjectMember[];
  sources: ResearchWorkspaceSourceRecord[];
  artifacts: ResearchWorkspaceArtifact[];
  runs: ResearchWorkspaceRun[];
  warnings: string[];
}

export interface ResearchWorkspaceFileOps {
  ensureDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string | undefined>;
  writeTextAtomic(path: string, contents: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
}

export interface ResearchWorkspaceRepositoryOptions {
  rootDir: string;
  fileOps: ResearchWorkspaceFileOps;
  now?: () => Date;
  idFactory?: (prefix: string) => string;
}

export class ResearchWorkspaceRevisionConflictError extends Error {
  constructor(
    public readonly path: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(
      `Research Workspace revision conflict at ${path}: expected ${expectedRevision}, found ${actualRevision}.`,
    );
    this.name = "ResearchWorkspaceRevisionConflictError";
  }
}

export class ResearchWorkspaceNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} ${id} was not found.`);
    this.name = "ResearchWorkspaceNotFoundError";
  }
}

export function assertResearchWorkspaceID(value: string, label: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} contains unsupported path characters.`);
  }
  return value;
}

export function assertResearchWorkspaceMember(
  member: ResearchWorkspaceProjectMember,
) {
  if (!member.sourceID.trim())
    throw new Error("Project member SourceID is required.");
  if (member.reviewStatus === "excluded" && !member.exclusionReason?.trim()) {
    throw new Error("Excluded project members require an exclusion reason.");
  }
}
