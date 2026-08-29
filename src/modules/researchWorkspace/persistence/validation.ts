import {
  RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_MIGRATION_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION,
  assertResearchWorkspaceID,
  assertResearchWorkspaceMember,
  type ResearchWorkspaceArtifactFile,
  type ResearchWorkspaceCatalog,
  type ResearchWorkspaceMembersFile,
  type ResearchWorkspaceLegacyMigrationFile,
  type ResearchWorkspaceProjectFile,
  type ResearchWorkspacePreferencesFile,
  type ResearchWorkspaceRunFile,
  type ResearchWorkspaceSourceFile,
} from "./contracts";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function revision(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function schema(value: unknown, expected: number, label: string) {
  if (value !== expected) {
    throw new Error(`${label} schema ${String(value)} is unsupported.`);
  }
}

function stringArray(value: unknown, label: string) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${label} must be an array of strings.`);
  }
}

function oneOf(value: unknown, allowed: readonly string[], label: string) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is unsupported: ${String(value)}.`);
  }
}

const ENGINE_MODES = ["codex_cli", "claude_code", "gemini_cli"] as const;
const MEMBER_ROLES = [
  "seed",
  "candidate",
  "background",
  "comparison",
  "included",
] as const;
const REVIEW_STATUSES = [
  "unreviewed",
  "maybe",
  "up-next",
  "skimmed",
  "read",
  "understood",
  "included",
  "excluded",
] as const;
const ARTIFACT_TYPES = [
  "claim-ledger",
  "critical-read",
  "methodology-audit",
  "paper-mastery",
  "reproducibility",
  "paper-to-code",
  "evidence-matrix",
  "relationship-graph",
  "cross-paper-mastery",
  "citation-context",
  "citation-stance",
  "synthesis",
  "review-log",
] as const;
const ARTIFACT_STATUSES = [
  "draft",
  "partial",
  "complete",
  "failed",
  "stale",
  "superseded",
] as const;
const RUN_STATUSES = [
  "queued",
  "preparing",
  "running",
  "cancelling",
  "partial",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;

function validateProject(value: unknown) {
  const project = object(value, "project");
  assertResearchWorkspaceID(text(project.projectID, "projectID"), "projectID");
  text(project.name, "project name");
  text(project.createdAt, "project createdAt");
  text(project.updatedAt, "project updatedAt");
  stringArray(project.artifactIDs, "project artifactIDs");
  stringArray(project.runIDs, "project runIDs");
  if (project.defaultEngineMode !== undefined) {
    oneOf(project.defaultEngineMode, ENGINE_MODES, "project defaultEngineMode");
  }
  for (const id of project.artifactIDs as string[]) {
    assertResearchWorkspaceID(id, "artifactID");
  }
  for (const id of project.runIDs as string[]) {
    assertResearchWorkspaceID(id, "runID");
  }
}

export function parseResearchWorkspaceCatalog(
  value: unknown,
): ResearchWorkspaceCatalog {
  const root = object(value, "catalog");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
    "catalog",
  );
  revision(root.revision, "catalog revision");
  text(root.createdAt, "catalog createdAt");
  text(root.updatedAt, "catalog updatedAt");
  if (!Array.isArray(root.projects)) {
    throw new Error("catalog projects must be an array.");
  }
  const seen = new Set<string>();
  for (const entry of root.projects) {
    const project = object(entry, "catalog project");
    const projectID = assertResearchWorkspaceID(
      text(project.projectID, "catalog projectID"),
      "projectID",
    );
    if (seen.has(projectID)) throw new Error(`Duplicate project ${projectID}.`);
    seen.add(projectID);
    text(project.name, "catalog project name");
    text(project.updatedAt, "catalog project updatedAt");
    revision(project.memberCount, "catalog memberCount");
    revision(project.staleArtifactCount, "catalog staleArtifactCount");
  }
  return value as ResearchWorkspaceCatalog;
}

export function parseResearchWorkspaceProjectFile(
  value: unknown,
): ResearchWorkspaceProjectFile {
  const root = object(value, "project file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_PROJECT_SCHEMA_VERSION,
    "project file",
  );
  revision(root.revision, "project revision");
  validateProject(root.project);
  return value as ResearchWorkspaceProjectFile;
}

export function parseResearchWorkspaceMembersFile(
  value: unknown,
): ResearchWorkspaceMembersFile {
  const root = object(value, "members file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_MEMBERS_SCHEMA_VERSION,
    "members file",
  );
  revision(root.revision, "members revision");
  assertResearchWorkspaceID(
    text(root.projectID, "members projectID"),
    "projectID",
  );
  if (!Array.isArray(root.members)) {
    throw new Error("members must be an array.");
  }
  const seen = new Set<string>();
  for (const entry of root.members) {
    const member = object(entry, "project member");
    text(member.sourceID, "member sourceID");
    oneOf(member.role, MEMBER_ROLES, "member role");
    oneOf(member.reviewStatus, REVIEW_STATUSES, "member reviewStatus");
    text(member.addedAt, "member addedAt");
    text(member.updatedAt, "member updatedAt");
    assertResearchWorkspaceMember(
      entry as ResearchWorkspaceMembersFile["members"][number],
    );
    const sourceID = String(member.sourceID);
    if (seen.has(sourceID)) throw new Error(`Duplicate member ${sourceID}.`);
    seen.add(sourceID);
  }
  return value as ResearchWorkspaceMembersFile;
}

export function parseResearchWorkspaceSourceFile(
  value: unknown,
): ResearchWorkspaceSourceFile {
  const root = object(value, "source file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_SOURCE_SCHEMA_VERSION,
    "source file",
  );
  revision(root.revision, "source revision");
  const source = object(root.source, "source");
  text(source.sourceID, "sourceID");
  text(source.title, "source title");
  oneOf(
    source.extractionQuality,
    ["structured", "zotero_text", "unavailable"],
    "source extractionQuality",
  );
  oneOf(
    source.availability,
    ["ready", "missing-file", "unreadable", "detached"],
    "source availability",
  );
  text(source.lastResolvedAt, "source lastResolvedAt");
  if (!Array.isArray(source.extractionNotes)) {
    throw new Error("source extractionNotes must be an array.");
  }
  const identity = object(source.identity, "source identity");
  if (!Number.isInteger(identity.libraryID)) {
    throw new Error("source libraryID must be an integer.");
  }
  if (Number(identity.libraryID) <= 0) {
    const legacyIdentity = object(
      source.legacyIdentity,
      "legacy source identity",
    );
    if (
      source.availability !== "detached" ||
      !["detached", "ambiguous"].includes(String(legacyIdentity.resolution))
    ) {
      throw new Error(
        "source libraryID must be positive unless an unresolved legacy source is detached.",
      );
    }
  }
  text(identity.itemKey, "source itemKey");
  text(identity.attachmentKey, "source attachmentKey");
  if (typeof identity.standaloneAttachment !== "boolean") {
    throw new Error("source standaloneAttachment must be boolean.");
  }
  return value as ResearchWorkspaceSourceFile;
}

export function parseResearchWorkspaceArtifactFile(
  value: unknown,
): ResearchWorkspaceArtifactFile {
  const root = object(value, "artifact file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
    "artifact file",
  );
  revision(root.revision, "artifact revision");
  const artifact = object(root.artifact, "artifact");
  assertResearchWorkspaceID(
    text(artifact.artifactID, "artifactID"),
    "artifactID",
  );
  assertResearchWorkspaceID(
    text(artifact.projectID, "artifact projectID"),
    "projectID",
  );
  oneOf(artifact.type, ARTIFACT_TYPES, "artifact type");
  text(artifact.title, "artifact title");
  revision(artifact.version, "artifact version");
  oneOf(artifact.status, ARTIFACT_STATUSES, "artifact status");
  stringArray(artifact.sourceIDs, "artifact sourceIDs");
  text(artifact.createdAt, "artifact createdAt");
  text(artifact.updatedAt, "artifact updatedAt");
  const lineage = object(artifact.lineage, "artifact lineage");
  text(lineage.operation, "lineage operation");
  text(lineage.operationVersion, "lineage operationVersion");
  text(lineage.promptVersion, "lineage promptVersion");
  text(lineage.parserVersion, "lineage parserVersion");
  text(lineage.evidenceVerifierVersion, "lineage evidenceVerifierVersion");
  oneOf(
    lineage.providerMode,
    [...ENGINE_MODES, "unknown"],
    "lineage providerMode",
  );
  assertResearchWorkspaceID(text(lineage.runID, "lineage runID"), "runID");
  if (!Array.isArray(lineage.inputs)) {
    throw new Error("lineage inputs must be an array.");
  }
  for (const input of lineage.inputs) {
    const item = object(input, "lineage input");
    text(item.sourceID, "lineage sourceID");
    text(item.contentFingerprint, "lineage contentFingerprint");
    text(
      item.contextProjectionFingerprint,
      "lineage contextProjectionFingerprint",
    );
  }
  return value as ResearchWorkspaceArtifactFile;
}

export function parseResearchWorkspaceRunFile(
  value: unknown,
): ResearchWorkspaceRunFile {
  const root = object(value, "run file");
  schema(root.schemaVersion, RESEARCH_WORKSPACE_RUN_SCHEMA_VERSION, "run file");
  revision(root.revision, "run revision");
  const run = object(root.run, "run");
  assertResearchWorkspaceID(text(run.runID, "runID"), "runID");
  text(run.operation, "run operation");
  text(run.operationVersion, "run operationVersion");
  oneOf(run.status, RUN_STATUSES, "run status");
  text(run.updatedAt, "run updatedAt");
  const owner = object(run.owner, "run owner");
  oneOf(owner.kind, ["paper", "project"], "run owner kind");
  if (owner.kind === "project") {
    assertResearchWorkspaceID(
      text(owner.projectID, "run owner projectID"),
      "projectID",
    );
  } else {
    text(owner.sourceID, "run owner sourceID");
    if (!Number.isInteger(owner.itemID) || Number(owner.itemID) <= 0) {
      throw new Error("paper run owner itemID must be positive.");
    }
  }
  if (!Array.isArray(run.sourceSnapshot)) {
    throw new Error("run sourceSnapshot must be an array.");
  }
  object(run.progress, "run progress");
  return value as ResearchWorkspaceRunFile;
}

export function parseResearchWorkspacePreferencesFile(
  value: unknown,
): ResearchWorkspacePreferencesFile {
  const root = object(value, "preferences file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
    "preferences file",
  );
  revision(root.revision, "preferences revision");
  text(root.createdAt, "preferences createdAt");
  text(root.updatedAt, "preferences updatedAt");
  const preferences = object(root.preferences, "preferences");
  oneOf(
    preferences.responseLanguage,
    ["English", "Korean", "Chinese"],
    "responseLanguage",
  );
  const maxPaperCharacters = Number(preferences.maxPaperCharacters);
  if (
    !Number.isInteger(maxPaperCharacters) ||
    maxPaperCharacters < 10_000 ||
    maxPaperCharacters > 10_000_000
  ) {
    throw new Error("maxPaperCharacters is out of range.");
  }
  const artifactHistoryLimit = Number(preferences.artifactHistoryLimit);
  if (
    !Number.isInteger(artifactHistoryLimit) ||
    artifactHistoryLimit < 1 ||
    artifactHistoryLimit > 100
  ) {
    throw new Error("artifactHistoryLimit is out of range.");
  }
  if (typeof preferences.retainRawRunLogs !== "boolean") {
    throw new Error("retainRawRunLogs must be boolean.");
  }
  return value as ResearchWorkspacePreferencesFile;
}

export function parseResearchWorkspaceLegacyMigrationFile(
  value: unknown,
): ResearchWorkspaceLegacyMigrationFile {
  const root = object(value, "legacy migration file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_MIGRATION_SCHEMA_VERSION,
    "legacy migration file",
  );
  revision(root.revision, "legacy migration revision");
  const migration = object(root.migration, "legacy migration");
  text(migration.importerVersion, "legacy importerVersion");
  oneOf(migration.status, ["in-progress", "completed"], "migration status");
  text(migration.legacyPath, "legacy path");
  text(migration.startedAt, "migration startedAt");
  assertResearchWorkspaceID(
    text(migration.createdProjectID, "migration projectID"),
    "projectID",
  );
  const fingerprint = object(migration.legacyFingerprint, "legacy fingerprint");
  oneOf(
    fingerprint.algorithm,
    ["sha256", "fnv1a-128-fallback"],
    "legacy fingerprint algorithm",
  );
  text(fingerprint.value, "legacy fingerprint value");
  const summary = object(migration.summary, "legacy migration summary");
  revision(summary.migratedSources, "migratedSources");
  revision(summary.skippedSources, "skippedSources");
  revision(summary.detachedSources, "detachedSources");
  revision(summary.ambiguousSources, "ambiguousSources");
  object(summary.artifactCounts, "artifactCounts");
  if (
    !Array.isArray(summary.warnings) ||
    summary.warnings.some((warning) => typeof warning !== "string")
  ) {
    throw new Error("migration warnings must be an array of strings.");
  }
  return value as ResearchWorkspaceLegacyMigrationFile;
}

export function parseStoredJSON<T>(
  textValue: string,
  path: string,
  parser: (value: unknown) => T,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textValue);
  } catch (error) {
    throw new Error(
      `Invalid Research Workspace JSON at ${path}: ${String(error)}`,
    );
  }
  return parser(parsed);
}
