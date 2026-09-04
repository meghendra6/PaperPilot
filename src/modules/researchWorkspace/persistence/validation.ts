import {
  RESEARCH_WORKSPACE_ARTIFACT_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_CATALOG_SCHEMA_VERSION,
  RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
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
  type ResearchWorkspaceChangeInboxFile,
  type ResearchWorkspaceMembersFile,
  type ResearchWorkspaceLegacyMigrationFile,
  type ResearchProject,
  type ResearchWorkspaceProjectFile,
  type ResearchWorkspacePreferencesFile,
  type ResearchWorkspaceRunFile,
  type ResearchWorkspaceSourceFile,
} from "./contracts";
import { parseZoteroSourceID } from "../sourceIdentity";
import { parseCitationHealthReport } from "../citationHealth";
import { validateResearchWorkspaceProjectTemplateState } from "../projectTemplates";

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

function optionalText(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
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

function isoDate(value: unknown, label: string) {
  const candidate = text(value, label);
  const parsed = new Date(candidate);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== candidate
  )
    throw new Error(`${label} must be a canonical ISO date.`);
  return candidate;
}

function normalizedCopy<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function livingReviewSourceID(value: unknown, label: string) {
  const candidate = text(value, label);
  if (
    candidate.length > 512 ||
    (parseZoteroSourceID(candidate) === undefined &&
      !/^legacy:[0-9a-f]{20}$/.test(candidate))
  ) {
    throw new Error(`${label} is not a supported Research Workspace sourceID.`);
  }
  return candidate;
}

function boundedFingerprint(value: unknown, label: string) {
  const candidate = text(value, label);
  if (candidate.length > 2_048) {
    throw new Error(`${label} is too long.`);
  }
  return candidate;
}

function validateContentFingerprint(value: unknown, label: string) {
  const fingerprint = object(value, label);
  oneOf(
    fingerprint.algorithm,
    ["sha256", "zotero-version-mtime-size-v1"],
    `${label} algorithm`,
  );
  boundedFingerprint(fingerprint.value, `${label} value`);
  for (const field of ["fileSize", "modifiedTime", "zoteroVersion"] as const) {
    if (
      fingerprint[field] !== undefined &&
      (!Number.isFinite(fingerprint[field]) || Number(fingerprint[field]) < 0)
    ) {
      throw new Error(`${label} ${field} must be a non-negative number.`);
    }
  }
  return fingerprint;
}

function validateLivingReviewState(value: unknown, label: string) {
  const state = object(value, label);
  oneOf(
    state.availability,
    ["ready", "missing-file", "unreadable", "detached"],
    `${label} availability`,
  );
  if (state.contentFingerprint !== undefined) {
    boundedFingerprint(state.contentFingerprint, `${label} contentFingerprint`);
  }
  if (state.annotationFingerprint !== undefined) {
    boundedFingerprint(
      state.annotationFingerprint,
      `${label} annotationFingerprint`,
    );
  }
  return state;
}

function validateCriterion(value: unknown, label: string, seen: Set<string>) {
  const criterion = object(value, label);
  const criterionID = assertResearchWorkspaceID(
    text(criterion.criterionID, `${label} ID`),
    "criterionID",
  );
  if (seen.has(criterionID)) {
    throw new Error(`Duplicate criterion ${criterionID}.`);
  }
  seen.add(criterionID);
  const criterionText = text(criterion.text, `${label} text`);
  if (criterionText.length > 500) throw new Error(`${label} text is too long.`);
  if (typeof criterion.enabled !== "boolean") {
    throw new Error(`${label} enabled must be a boolean.`);
  }
  oneOf(criterion.createdBy, ["user", "suggested"], `${label} createdBy`);
  if (criterion.acceptedAt !== undefined) {
    isoDate(criterion.acceptedAt, `${label} acceptedAt`);
  }
}

function validateProjectScope(value: unknown) {
  const scope = object(value, "project scope");
  const seen = new Set<string>();
  for (const key of ["inclusionCriteria", "exclusionCriteria"] as const) {
    if (!Array.isArray(scope[key]) || scope[key].length > 100) {
      throw new Error(`project scope ${key} must be an array of at most 100.`);
    }
    scope[key].forEach((criterion, index) =>
      validateCriterion(criterion, `${key}[${index}]`, seen),
    );
  }
  if (scope.pico !== undefined) {
    const pico = object(scope.pico, "project PICO");
    for (const key of ["population", "intervention", "comparison", "outcome"]) {
      if (pico[key] === undefined) continue;
      if (typeof pico[key] !== "string" || String(pico[key]).length > 1_000) {
        throw new Error(`project PICO ${key} must be a bounded string.`);
      }
    }
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
  "citation-health",
  "synthesis",
  "contradiction-gap-dashboard",
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
  optionalText(project.description, "project description");
  optionalText(project.researchQuestion, "project researchQuestion");
  isoDate(project.createdAt, "project createdAt");
  isoDate(project.updatedAt, "project updatedAt");
  if (project.archivedAt !== undefined)
    isoDate(project.archivedAt, "project archivedAt");
  stringArray(project.artifactIDs, "project artifactIDs");
  stringArray(project.runIDs, "project runIDs");
  if (project.defaultEngineMode !== undefined) {
    oneOf(project.defaultEngineMode, ENGINE_MODES, "project defaultEngineMode");
  }
  if (project.activeArtifactID !== undefined) {
    assertResearchWorkspaceID(
      text(project.activeArtifactID, "project activeArtifactID"),
      "artifactID",
    );
  }
  if (project.scope !== undefined) validateProjectScope(project.scope);
  validateResearchWorkspaceProjectTemplateState(
    project as unknown as ResearchProject,
  );
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
  isoDate(root.createdAt, "catalog createdAt");
  isoDate(root.updatedAt, "catalog updatedAt");
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
    isoDate(project.updatedAt, "catalog project updatedAt");
    if (project.archivedAt !== undefined)
      isoDate(project.archivedAt, "catalog project archivedAt");
    revision(project.memberCount, "catalog memberCount");
    revision(project.staleArtifactCount, "catalog staleArtifactCount");
    if (project.dueMasteryReviewCount !== undefined) {
      revision(project.dueMasteryReviewCount, "catalog dueMasteryReviewCount");
    }
  }
  return normalizedCopy(value) as ResearchWorkspaceCatalog;
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
  return normalizedCopy(value) as ResearchWorkspaceProjectFile;
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
  const eventIDs = new Set<string>();
  const submissionIDs = new Set<string>();
  for (const entry of root.members) {
    const member = object(entry, "project member");
    text(member.sourceID, "member sourceID");
    oneOf(member.role, MEMBER_ROLES, "member role");
    oneOf(member.reviewStatus, REVIEW_STATUSES, "member reviewStatus");
    isoDate(member.addedAt, "member addedAt");
    isoDate(member.updatedAt, "member updatedAt");
    optionalText(member.exclusionReason, "member exclusionReason");
    optionalText(member.userNote, "member userNote");
    if (member.screeningEvents !== undefined) {
      if (
        !Array.isArray(member.screeningEvents) ||
        member.screeningEvents.length > 500
      ) {
        throw new Error(
          "member screeningEvents must be an array of at most 500.",
        );
      }
      for (const [index, value] of member.screeningEvents.entries()) {
        const label = `screening event ${index + 1}`;
        const event = object(value, label);
        const eventID = assertResearchWorkspaceID(
          text(event.eventID, `${label} eventID`),
          "screening eventID",
        );
        const submissionID = assertResearchWorkspaceID(
          text(event.submissionID, `${label} submissionID`),
          "screening submissionID",
        );
        if (eventIDs.has(eventID))
          throw new Error(`Duplicate event ${eventID}.`);
        if (submissionIDs.has(submissionID)) {
          throw new Error(`Duplicate submission ${submissionID}.`);
        }
        eventIDs.add(eventID);
        submissionIDs.add(submissionID);
        if (event.sourceID !== member.sourceID) {
          throw new Error(`${label} sourceID does not match its member.`);
        }
        oneOf(event.stage, ["abstract", "full-text"], `${label} stage`);
        oneOf(
          event.decision,
          ["include", "exclude", "maybe"],
          `${label} decision`,
        );
        oneOf(event.actor, ["local-user"], `${label} actor`);
        text(event.protocolFingerprint, `${label} protocolFingerprint`);
        isoDate(event.decidedAt, `${label} decidedAt`);
        if (
          !Array.isArray(event.protocolSnapshot) ||
          event.protocolSnapshot.length > 200
        ) {
          throw new Error(`${label} protocolSnapshot must be a bounded array.`);
        }
        const criterionIDs = new Set<string>();
        for (const [
          criterionIndex,
          candidate,
        ] of event.protocolSnapshot.entries()) {
          const criterion = object(
            candidate,
            `${label} criterion ${criterionIndex + 1}`,
          );
          const criterionID = assertResearchWorkspaceID(
            text(criterion.criterionID, `${label} criterionID`),
            "screening criterionID",
          );
          if (criterionIDs.has(criterionID)) {
            throw new Error(`${label} has duplicate criterion ${criterionID}.`);
          }
          criterionIDs.add(criterionID);
          oneOf(
            criterion.kind,
            ["inclusion", "exclusion"],
            `${label} criterion kind`,
          );
          text(criterion.text, `${label} criterion text`);
        }
        const sourceSnapshot = object(
          event.sourceSnapshot,
          `${label} sourceSnapshot`,
        );
        text(sourceSnapshot.title, `${label} source title`);
        oneOf(
          sourceSnapshot.availability,
          ["ready", "missing-file", "unreadable", "detached"],
          `${label} source availability`,
        );
        if (
          sourceSnapshot.year !== undefined &&
          (!Number.isInteger(sourceSnapshot.year) ||
            Number(sourceSnapshot.year) < 0)
        ) {
          throw new Error(
            `${label} source year must be a non-negative integer.`,
          );
        }
        optionalText(sourceSnapshot.doi, `${label} source DOI`);
        optionalText(
          sourceSnapshot.contentFingerprint,
          `${label} source contentFingerprint`,
        );
        optionalText(event.note, `${label} note`);
        if (event.reason !== undefined) {
          const reason = object(event.reason, `${label} reason`);
          oneOf(
            reason.code,
            ["criterion", "duplicate", "missing-pdf", "other"],
            `${label} reason code`,
          );
          text(reason.text, `${label} reason text`);
          if (reason.criterionIDs !== undefined) {
            stringArray(reason.criterionIDs, `${label} criterionIDs`);
            for (const criterionID of reason.criterionIDs as string[]) {
              if (!criterionIDs.has(criterionID)) {
                throw new Error(
                  `${label} references unknown criterion ${criterionID}.`,
                );
              }
            }
          }
        }
        if (event.decision === "exclude" && event.reason === undefined) {
          throw new Error(`${label} exclusion requires a reason.`);
        }
        const previousEvent = member.screeningEvents[index - 1] as
          | Record<string, unknown>
          | undefined;
        if (index === 0 && event.supersedesEventID !== undefined) {
          throw new Error(
            `${label} supersedes an event that is not earlier in the history.`,
          );
        }
        if (index > 0 && event.supersedesEventID !== previousEvent?.eventID) {
          throw new Error(
            `${label} must supersede the immediately prior event.`,
          );
        }
      }
    }
    assertResearchWorkspaceMember(
      normalizedCopy(entry) as ResearchWorkspaceMembersFile["members"][number],
    );
    const sourceID = String(member.sourceID);
    if (seen.has(sourceID)) throw new Error(`Duplicate member ${sourceID}.`);
    seen.add(sourceID);
  }
  return normalizedCopy(value) as ResearchWorkspaceMembersFile;
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
  livingReviewSourceID(source.sourceID, "sourceID");
  text(source.title, "source title");
  if (source.creators !== undefined)
    stringArray(source.creators, "source creators");
  if (
    source.year !== undefined &&
    (!Number.isInteger(source.year) || Number(source.year) < 0)
  ) {
    throw new Error("source year must be a non-negative integer.");
  }
  optionalText(source.doi, "source DOI");
  for (const field of ["runtimeItemID", "runtimeAttachmentID"] as const) {
    if (
      source[field] !== undefined &&
      (!Number.isInteger(source[field]) || Number(source[field]) <= 0)
    ) {
      throw new Error(`source ${field} must be a positive integer.`);
    }
  }
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
  isoDate(source.lastResolvedAt, "source lastResolvedAt");
  if (source.lastExtractedAt !== undefined)
    isoDate(source.lastExtractedAt, "source lastExtractedAt");
  stringArray(source.extractionNotes, "source extractionNotes");
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
  if (source.contentFingerprint !== undefined) {
    validateContentFingerprint(source.contentFingerprint, "source fingerprint");
  }
  if (source.extractionFingerprint !== undefined) {
    const extraction = object(
      source.extractionFingerprint,
      "source extraction fingerprint",
    );
    validateContentFingerprint(
      extraction.contentFingerprint,
      "source extraction content fingerprint",
    );
    oneOf(
      extraction.extractor,
      ["opendataloader-pdf", "zotero-attachment-text"],
      "source extractor",
    );
    text(extraction.extractorVersion, "source extractorVersion");
    text(
      extraction.extractionOptionsVersion,
      "source extractionOptionsVersion",
    );
  }
  if (source.legacyIdentity !== undefined) {
    const legacy = object(source.legacyIdentity, "legacy source identity");
    optionalText(legacy.paperKey, "legacy paperKey");
    optionalText(legacy.attachmentKey, "legacy attachmentKey");
    oneOf(
      legacy.resolution,
      ["resolved", "detached", "ambiguous"],
      "legacy resolution",
    );
  }
  return normalizedCopy(value) as ResearchWorkspaceSourceFile;
}

export function parseResearchWorkspaceChangeInboxFile(
  value: unknown,
): ResearchWorkspaceChangeInboxFile {
  const root = object(value, "change inbox file");
  schema(
    root.schemaVersion,
    RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
    "change inbox file",
  );
  revision(root.revision, "change inbox revision");
  assertResearchWorkspaceID(
    text(root.projectID, "change inbox projectID"),
    "projectID",
  );
  if (root.initializedAt !== undefined) {
    isoDate(root.initializedAt, "change inbox initializedAt");
  }
  if (root.lastCheckedAt !== undefined) {
    isoDate(root.lastCheckedAt, "change inbox lastCheckedAt");
  }
  if (!Array.isArray(root.snapshots) || root.snapshots.length > 10_000) {
    throw new Error(
      "change inbox snapshots must be an array of at most 10000.",
    );
  }
  if (!Array.isArray(root.changes) || root.changes.length > 10_000) {
    throw new Error("change inbox changes must be an array of at most 10000.");
  }

  const snapshotSourceIDs = new Set<string>();
  for (const [index, value] of root.snapshots.entries()) {
    const label = `change inbox snapshot ${index + 1}`;
    const snapshot = validateLivingReviewState(value, label);
    const sourceID = livingReviewSourceID(
      snapshot.sourceID,
      `${label} sourceID`,
    );
    if (snapshotSourceIDs.has(sourceID)) {
      throw new Error(`Duplicate change inbox snapshot for ${sourceID}.`);
    }
    snapshotSourceIDs.add(sourceID);
    isoDate(snapshot.observedAt, `${label} observedAt`);

    const hasFingerprint = snapshot.annotationFingerprint !== undefined;
    const hasAnnotation = snapshot.annotation !== undefined;
    if (hasFingerprint !== hasAnnotation) {
      throw new Error(
        `${label} annotationFingerprint and annotation metadata must both be present.`,
      );
    }
    if (hasAnnotation) {
      const annotation = object(snapshot.annotation, `${label} annotation`);
      oneOf(
        annotation.algorithm,
        ["zotero-annotation-keys-version-date-v1"],
        `${label} annotation algorithm`,
      );
      const annotationValue = boundedFingerprint(
        annotation.value,
        `${label} annotation value`,
      );
      const annotationCount = revision(
        annotation.count,
        `${label} annotation count`,
      );
      if (annotationCount > 1_000_000) {
        throw new Error(`${label} annotation count is too large.`);
      }
      if (annotationValue !== snapshot.annotationFingerprint) {
        throw new Error(
          `${label} annotation value does not match annotationFingerprint.`,
        );
      }
    }
  }

  const changeIDs = new Set<string>();
  const dedupeKeys = new Set<string>();
  const submissionIDs = new Set<string>();
  for (const [index, value] of root.changes.entries()) {
    const label = `change inbox change ${index + 1}`;
    const change = object(value, label);
    const changeID = assertResearchWorkspaceID(
      text(change.changeID, `${label} changeID`),
      "changeID",
    );
    if (changeIDs.has(changeID)) {
      throw new Error(`Duplicate change inbox changeID ${changeID}.`);
    }
    changeIDs.add(changeID);
    const dedupeKey = boundedFingerprint(
      change.dedupeKey,
      `${label} dedupeKey`,
    );
    if (dedupeKeys.has(dedupeKey)) {
      throw new Error(`Duplicate change inbox dedupeKey ${dedupeKey}.`);
    }
    dedupeKeys.add(dedupeKey);
    livingReviewSourceID(change.sourceID, `${label} sourceID`);
    oneOf(
      change.kind,
      [
        "project-source-added",
        "pdf-content-changed",
        "annotations-changed",
        "source-unavailable",
        "source-restored",
      ],
      `${label} kind`,
    );
    validateLivingReviewState(change.before, `${label} before`);
    validateLivingReviewState(change.after, `${label} after`);
    isoDate(change.detectedAt, `${label} detectedAt`);
    if (change.resolution !== undefined) {
      const resolutionValue = object(change.resolution, `${label} resolution`);
      oneOf(
        resolutionValue.action,
        ["reviewed", "dismissed"],
        `${label} resolution action`,
      );
      const submissionID = assertResearchWorkspaceID(
        text(resolutionValue.submissionID, `${label} resolution submissionID`),
        "submissionID",
      );
      if (submissionIDs.has(submissionID)) {
        throw new Error(
          `Duplicate change inbox resolution submissionID ${submissionID}.`,
        );
      }
      submissionIDs.add(submissionID);
      isoDate(resolutionValue.actedAt, `${label} resolution actedAt`);
    }
  }
  return normalizedCopy(value) as ResearchWorkspaceChangeInboxFile;
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
  const artifactID = assertResearchWorkspaceID(
    text(artifact.artifactID, "artifactID"),
    "artifactID",
  );
  assertResearchWorkspaceID(
    text(artifact.projectID, "artifact projectID"),
    "projectID",
  );
  oneOf(artifact.type, ARTIFACT_TYPES, "artifact type");
  text(artifact.title, "artifact title");
  if (revision(artifact.version, "artifact version") < 1) {
    throw new Error("artifact version must be positive.");
  }
  oneOf(artifact.status, ARTIFACT_STATUSES, "artifact status");
  stringArray(artifact.sourceIDs, "artifact sourceIDs");
  const sourceIDs = artifact.sourceIDs as string[];
  if (new Set(sourceIDs).size !== sourceIDs.length) {
    throw new Error("artifact sourceIDs must be unique.");
  }
  isoDate(artifact.createdAt, "artifact createdAt");
  isoDate(artifact.updatedAt, "artifact updatedAt");
  if (artifact.completedAt !== undefined)
    isoDate(artifact.completedAt, "artifact completedAt");
  if (artifact.lastCurrentAt !== undefined)
    isoDate(artifact.lastCurrentAt, "artifact lastCurrentAt");
  if (artifact.supersedesArtifactID !== undefined) {
    assertResearchWorkspaceID(
      text(artifact.supersedesArtifactID, "artifact supersedesArtifactID"),
      "artifactID",
    );
  }
  if (artifact.staleReasons !== undefined)
    stringArray(artifact.staleReasons, "artifact staleReasons");
  const lineage = object(artifact.lineage, "artifact lineage");
  text(lineage.operation, "lineage operation");
  text(lineage.operationVersion, "lineage operationVersion");
  text(lineage.promptVersion, "lineage promptVersion");
  text(lineage.parserVersion, "lineage parserVersion");
  text(lineage.evidenceVerifierVersion, "lineage evidenceVerifierVersion");
  if (lineage.schemaVersion !== undefined)
    text(lineage.schemaVersion, "lineage schemaVersion");
  optionalText(lineage.model, "lineage model");
  oneOf(
    lineage.providerMode,
    [...ENGINE_MODES, "local", "unknown"],
    "lineage providerMode",
  );
  assertResearchWorkspaceID(text(lineage.runID, "lineage runID"), "runID");
  if (!Array.isArray(lineage.inputs)) {
    throw new Error("lineage inputs must be an array.");
  }
  const lineageSourceIDs = new Set<string>();
  for (const input of lineage.inputs) {
    const item = object(input, "lineage input");
    const sourceID = text(item.sourceID, "lineage sourceID");
    if (lineageSourceIDs.has(sourceID)) {
      throw new Error(`Duplicate lineage source input ${sourceID}.`);
    }
    lineageSourceIDs.add(sourceID);
    text(item.contentFingerprint, "lineage contentFingerprint");
    text(
      item.contextProjectionFingerprint,
      "lineage contextProjectionFingerprint",
    );
  }
  if (
    JSON.stringify([...lineageSourceIDs].sort()) !==
    JSON.stringify([...sourceIDs].sort())
  ) {
    throw new Error("artifact sourceIDs must match lineage source inputs.");
  }
  if (lineage.membersRevision !== undefined) {
    revision(lineage.membersRevision, "lineage membersRevision");
  }
  if (lineage.artifactInputs !== undefined) {
    if (
      !Array.isArray(lineage.artifactInputs) ||
      lineage.artifactInputs.length > 500
    ) {
      throw new Error("lineage artifactInputs must be a bounded array.");
    }
    const artifactInputIDs = new Set<string>();
    for (const input of lineage.artifactInputs) {
      const item = object(input, "lineage artifact input");
      const artifactID = assertResearchWorkspaceID(
        text(item.artifactID, "lineage artifact input ID"),
        "artifactID",
      );
      if (artifactInputIDs.has(artifactID)) {
        throw new Error(`Duplicate lineage artifact input ${artifactID}.`);
      }
      artifactInputIDs.add(artifactID);
      oneOf(item.artifactType, ARTIFACT_TYPES, "lineage artifact input type");
      if (revision(item.version, "lineage artifact input version") < 1) {
        throw new Error("lineage artifact input version must be positive.");
      }
      isoDate(item.updatedAt, "lineage artifact input updatedAt");
      text(
        item.payloadFingerprint,
        "lineage artifact input payloadFingerprint",
      );
    }
    if (artifactInputIDs.has(artifactID)) {
      throw new Error("An artifact cannot depend on itself.");
    }
  }
  if (artifact.payload === undefined) {
    throw new Error("artifact payload is required.");
  }
  try {
    JSON.stringify(artifact.payload);
  } catch {
    throw new Error("artifact payload must be JSON serializable.");
  }
  if (artifact.checkpoint !== undefined) {
    const checkpoint = object(artifact.checkpoint, "artifact checkpoint");
    stringArray(checkpoint.completedUnits, "checkpoint completedUnits");
    stringArray(checkpoint.pendingUnits, "checkpoint pendingUnits");
    if (!Array.isArray(checkpoint.failedUnits)) {
      throw new Error("checkpoint failedUnits must be an array.");
    }
    for (const [index, failed] of checkpoint.failedUnits.entries()) {
      const unit = object(failed, `checkpoint failedUnits[${index}]`);
      text(unit.unitID, `checkpoint failedUnits[${index}] unitID`);
      text(unit.message, `checkpoint failedUnits[${index}] message`);
    }
    isoDate(checkpoint.lastCheckpointAt, "checkpoint lastCheckpointAt");
    const allUnits = [
      ...(checkpoint.completedUnits as string[]),
      ...(checkpoint.pendingUnits as string[]),
      ...(checkpoint.failedUnits as Array<Record<string, unknown>>).map(
        (entry) => String(entry.unitID),
      ),
    ];
    if (new Set(allUnits).size !== allUnits.length) {
      throw new Error("checkpoint unit lists must not overlap.");
    }
  }
  if (artifact.type === "citation-health") {
    const report = parseCitationHealthReport(artifact.payload);
    if (report.projectID !== artifact.projectID) {
      throw new Error(
        "Citation Health payload projectID must match its artifact projectID.",
      );
    }
    if (report.scope.membersRevision !== lineage.membersRevision) {
      throw new Error(
        "Citation Health members revision must match artifact lineage.",
      );
    }
    if (
      JSON.stringify([...report.scope.includedSourceIDs].sort()) !==
      JSON.stringify([...sourceIDs].sort())
    ) {
      throw new Error(
        "Citation Health included sources must match artifact sourceIDs.",
      );
    }
    const reportedInputs = report.inputArtifacts
      .map((input) => [
        input.artifactID,
        input.artifactType,
        input.version,
        input.updatedAt,
        input.payloadFingerprint,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    const lineageInputs = (
      Array.isArray(lineage.artifactInputs) ? lineage.artifactInputs : []
    )
      .map((input) => {
        const item = input as Record<string, unknown>;
        return [
          item.artifactID,
          item.artifactType,
          item.version,
          item.updatedAt,
          item.payloadFingerprint,
        ];
      })
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    if (JSON.stringify(reportedInputs) !== JSON.stringify(lineageInputs)) {
      throw new Error(
        "Citation Health payload inputs must match artifact lineage inputs.",
      );
    }
  }
  return normalizedCopy(value) as ResearchWorkspaceArtifactFile;
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
  isoDate(run.updatedAt, "run updatedAt");
  if (run.startedAt !== undefined) isoDate(run.startedAt, "run startedAt");
  if (run.completedAt !== undefined)
    isoDate(run.completedAt, "run completedAt");
  optionalText(run.safeError, "run safeError");
  if (run.artifactID !== undefined) {
    assertResearchWorkspaceID(
      text(run.artifactID, "run artifactID"),
      "artifactID",
    );
  }
  if (run.projectID !== undefined) {
    assertResearchWorkspaceID(
      text(run.projectID, "run projectID"),
      "projectID",
    );
  }
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
  const snapshotSources = new Set<string>();
  for (const [index, value] of run.sourceSnapshot.entries()) {
    const snapshot = object(value, `run sourceSnapshot[${index}]`);
    const sourceID = text(
      snapshot.sourceID,
      `run sourceSnapshot[${index}] sourceID`,
    );
    if (snapshotSources.has(sourceID)) {
      throw new Error(`Duplicate run source snapshot ${sourceID}.`);
    }
    snapshotSources.add(sourceID);
    text(
      snapshot.contentFingerprint,
      `run sourceSnapshot[${index}] contentFingerprint`,
    );
  }
  const progress = object(run.progress, "run progress");
  text(progress.phase, "run progress phase");
  const completed = revision(progress.completed, "run progress completed");
  if (progress.total !== undefined) {
    const total = revision(progress.total, "run progress total");
    if (completed > total)
      throw new Error("run progress completed cannot exceed total.");
  }
  optionalText(progress.currentUnit, "run progress currentUnit");
  return normalizedCopy(value) as ResearchWorkspaceRunFile;
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
  const createdAt = isoDate(root.createdAt, "preferences createdAt");
  const updatedAt = isoDate(root.updatedAt, "preferences updatedAt");
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
  return {
    schemaVersion: RESEARCH_WORKSPACE_PREFERENCES_SCHEMA_VERSION,
    revision: revision(root.revision, "preferences revision"),
    preferences: {
      responseLanguage: preferences.responseLanguage as
        | "English"
        | "Korean"
        | "Chinese",
      maxPaperCharacters,
      artifactHistoryLimit,
      retainRawRunLogs: preferences.retainRawRunLogs,
    },
    createdAt,
    updatedAt,
  };
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
  isoDate(migration.startedAt, "migration startedAt");
  if (migration.completedAt !== undefined)
    isoDate(migration.completedAt, "migration completedAt");
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
  const artifactCounts = object(summary.artifactCounts, "artifactCounts");
  for (const [type, count] of Object.entries(artifactCounts)) {
    assertResearchWorkspaceID(type, "artifact type");
    revision(count, `artifact count ${type}`);
  }
  if (
    !Array.isArray(summary.warnings) ||
    summary.warnings.some((warning) => typeof warning !== "string")
  ) {
    throw new Error("migration warnings must be an array of strings.");
  }
  return normalizedCopy(value) as ResearchWorkspaceLegacyMigrationFile;
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
