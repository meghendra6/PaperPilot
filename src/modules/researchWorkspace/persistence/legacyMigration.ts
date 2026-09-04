import { migrateResearchWorkspaceState } from "../core/researchWorkspace/state";
import {
  buildZoteroSourceID,
  parseZoteroSourceID,
  type ZoteroSourceIdentity,
} from "../sourceIdentity";
import {
  RESEARCH_WORKSPACE_MIGRATION_SCHEMA_VERSION,
  type ResearchWorkspaceArtifactType,
  type ResearchWorkspaceContentFingerprint,
  type ResearchWorkspaceFileOps,
  type ResearchWorkspaceLegacyMigrationFile,
  type ResearchWorkspaceLegacyMigrationSummary,
  type ResearchWorkspaceSourceRecord,
} from "./contracts";
import { SerializedResearchWorkspaceFiles } from "./fileStore";
import {
  researchWorkspaceSourcePathID,
  type ResearchWorkspaceProjectRepository,
} from "./projectRepository";
import { parseResearchWorkspaceLegacyMigrationFile } from "./validation";

declare const Zotero: any;

export const RESEARCH_WORKSPACE_LEGACY_IMPORTER_VERSION = "v4-import@1";

export interface LegacySourceResolutionCandidate {
  sourceID: string;
  identity: ZoteroSourceIdentity;
  title: string;
  runtimeItemID?: number;
  runtimeAttachmentID?: number;
  creators?: string[];
  year?: number;
  doi?: string;
  availability: "ready" | "missing-file" | "unreadable";
}

export interface LegacySourceResolutionRequest {
  libraryID?: number;
  itemKey: string;
  attachmentKey: string;
}

export type LegacySourceResolver = (
  request: LegacySourceResolutionRequest,
) => Promise<LegacySourceResolutionCandidate[]>;

export interface LegacyResearchWorkspaceImporterOptions {
  rootDir: string;
  legacyPath: string;
  fileOps: ResearchWorkspaceFileOps;
  repository: ResearchWorkspaceProjectRepository;
  resolver?: LegacySourceResolver;
  now?: () => Date;
}

export interface LegacyResearchWorkspaceMigrationResult {
  status: "not-found" | "already-completed" | "completed";
  marker?: ResearchWorkspaceLegacyMigrationFile;
}

interface LegacyArtifactDescriptor {
  key: string;
  type: ResearchWorkspaceArtifactType;
  title: string;
  payload: unknown;
  sourceIDs: string[];
  inferredScope: boolean;
}

const LEGACY_ARTIFACT_OPERATIONS: Record<
  ResearchWorkspaceArtifactType,
  string
> = {
  "claim-ledger": "claims",
  "critical-read": "reader-critical-read",
  "methodology-audit": "critical-read",
  "paper-mastery": "paper-mastery",
  reproducibility: "reproducibility",
  "paper-to-code": "paper-to-code",
  "evidence-matrix": "evidence-matrix",
  "relationship-graph": "literature-graph",
  "cross-paper-mastery": "cross-paper-mastery",
  "citation-context": "citation-context-extraction",
  "citation-stance": "citation-stance",
  "citation-health": "citation-reference-health",
  synthesis: "project-synthesis",
  "contradiction-gap-dashboard": "contradiction-gap-dashboard",
  "review-log": "screening-log",
};

function legacyArtifactPayload(descriptor: LegacyArtifactDescriptor) {
  if (descriptor.type !== "paper-mastery") return descriptor.payload;
  const payload = object(descriptor.payload);
  return payload?.session
    ? descriptor.payload
    : { session: descriptor.payload };
}

function object(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

function pathJoin(...parts: string[]) {
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

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function fallbackFingerprint(value: string) {
  return [2166136261, 2246822519, 3266489917, 668265263]
    .map((seed) => hash32(value, seed))
    .join("");
}

export async function fingerprintLegacyWorkspace(contents: string) {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await runtimeCrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(contents),
    );
    const bytes = new Uint8Array(digest);
    let value = "";
    for (let index = 0; index < bytes.byteLength; index += 1) {
      value += Number(bytes[index]).toString(16).padStart(2, "0");
    }
    return {
      algorithm: "sha256" as const,
      value,
    };
  }
  return {
    algorithm: "fnv1a-128-fallback" as const,
    value: fallbackFingerprint(contents),
  };
}

async function getByLibraryAndKey(libraryID: number, key: string) {
  if (typeof Zotero.Items?.getByLibraryAndKeyAsync === "function") {
    return Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  }
  return Zotero.Items?.getByLibraryAndKey?.(libraryID, key);
}

async function getItem(itemID: number) {
  if (typeof Zotero.Items?.getAsync === "function") {
    return Zotero.Items.getAsync(itemID);
  }
  return Zotero.Items?.get?.(itemID);
}

function creators(item: any) {
  const values = item?.getCreators?.();
  if (!Array.isArray(values)) return undefined;
  const result = values
    .map((creator: any) =>
      String(
        creator?.name ||
          [creator?.firstName, creator?.lastName].filter(Boolean).join(" "),
      ).trim(),
    )
    .filter(Boolean);
  return result.length ? result : undefined;
}

export async function resolveLegacyZoteroSource(
  request: LegacySourceResolutionRequest,
): Promise<LegacySourceResolutionCandidate[]> {
  const libraryIDs = new Set<number>();
  if (request.libraryID && request.libraryID > 0) {
    libraryIDs.add(request.libraryID);
  } else {
    const libraries = await Promise.resolve(Zotero.Libraries?.getAll?.() ?? []);
    for (const library of libraries) {
      const id = Number(library?.libraryID ?? library?.id ?? library);
      if (Number.isInteger(id) && id > 0) libraryIDs.add(id);
    }
    const userLibraryID = Number(Zotero.Libraries?.userLibraryID);
    if (Number.isInteger(userLibraryID) && userLibraryID > 0) {
      libraryIDs.add(userLibraryID);
    }
  }

  const candidates: LegacySourceResolutionCandidate[] = [];
  for (const libraryID of libraryIDs) {
    const attachment = await getByLibraryAndKey(
      libraryID,
      request.attachmentKey,
    );
    if (!attachment?.isAttachment?.()) continue;
    let paperItem = attachment;
    if (attachment.parentItemID) {
      paperItem = await getItem(Number(attachment.parentItemID));
      if (!paperItem || String(paperItem.key) !== request.itemKey) continue;
    } else if (String(attachment.key) !== request.itemKey) {
      const explicitPaper = await getByLibraryAndKey(
        libraryID,
        request.itemKey,
      );
      if (
        !explicitPaper ||
        Number(explicitPaper.id) !== Number(attachment.id)
      ) {
        continue;
      }
      paperItem = explicitPaper;
    }
    const identity: ZoteroSourceIdentity = {
      libraryID,
      itemKey: request.itemKey,
      attachmentKey: request.attachmentKey,
      standaloneAttachment: Number(paperItem.id) === Number(attachment.id),
    };
    let availability: LegacySourceResolutionCandidate["availability"] = "ready";
    try {
      const filePath = await attachment.getFilePathAsync?.();
      if (!filePath && !String(attachment.attachmentText || "").trim()) {
        availability = "missing-file";
      }
    } catch {
      availability = "unreadable";
    }
    const date = String(paperItem.getField?.("date") || "");
    const yearMatch = date.match(/\b(18|19|20|21)\d{2}\b/);
    const doi = String(paperItem.getField?.("DOI") || "").trim();
    candidates.push({
      sourceID: buildZoteroSourceID(identity),
      identity,
      title: String(paperItem.getField?.("title") || "Untitled paper"),
      runtimeItemID: Number(paperItem.id),
      runtimeAttachmentID: Number(attachment.id),
      ...(creators(paperItem) ? { creators: creators(paperItem) } : {}),
      ...(yearMatch ? { year: Number(yearMatch[0]) } : {}),
      ...(doi ? { doi } : {}),
      availability,
    });
  }
  return candidates;
}

function normalizeContentFingerprint(
  value: unknown,
): ResearchWorkspaceContentFingerprint | undefined {
  if (typeof value === "string" && value) {
    return { algorithm: "zotero-version-mtime-size-v1", value };
  }
  const item = object(value);
  if (!item || typeof item.value !== "string" || !item.value) return undefined;
  return {
    algorithm:
      item.algorithm === "sha256" ? "sha256" : "zotero-version-mtime-size-v1",
    value: item.value,
    ...(typeof item.fileSize === "number" ? { fileSize: item.fileSize } : {}),
    ...(typeof item.modifiedTime === "number"
      ? { modifiedTime: item.modifiedTime }
      : {}),
    ...(typeof item.zoteroVersion === "number"
      ? { zoteroVersion: item.zoteroVersion }
      : {}),
  };
}

function collectPaperKeys(
  value: unknown,
  result = new Set<string>(),
  visited = new WeakSet<object>(),
) {
  if (!value || typeof value !== "object") return result;
  if (visited.has(value)) return result;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectPaperKeys(entry, result, visited);
    return result;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/paperkeys?$/i.test(key)) {
      if (typeof entry === "string") result.add(entry);
      if (Array.isArray(entry)) {
        for (const candidate of entry) {
          if (typeof candidate === "string") result.add(candidate);
        }
      }
    }
    collectPaperKeys(entry, result, visited);
  }
  return result;
}

function artifactSourceIDs(
  payload: unknown,
  sourceByLegacyKey: Map<string, string>,
  allSourceIDs: string[],
) {
  const matched = [...collectPaperKeys(payload)]
    .map((key) => sourceByLegacyKey.get(key))
    .filter((sourceID): sourceID is string => Boolean(sourceID));
  const unique = [...new Set(matched)];
  return unique.length
    ? { sourceIDs: unique, inferredScope: false }
    : { sourceIDs: [...allSourceIDs], inferredScope: true };
}

function legacyArtifactDescriptors(params: {
  state: any;
  sourceByLegacyKey: Map<string, string>;
  allSourceIDs: string[];
}) {
  const descriptors: LegacyArtifactDescriptor[] = [];
  const push = (
    key: string,
    type: ResearchWorkspaceArtifactType,
    title: string,
    payload: unknown,
    sourceIDs?: string[],
  ) => {
    if (payload === undefined || payload === null) return;
    const scope = sourceIDs?.length
      ? { sourceIDs: [...new Set(sourceIDs)], inferredScope: false }
      : artifactSourceIDs(
          payload,
          params.sourceByLegacyKey,
          params.allSourceIDs,
        );
    descriptors.push({ key, type, title, payload, ...scope });
  };

  for (const [legacyKey, rawPaper] of Object.entries(
    object(params.state.papers) ?? {},
  )) {
    const paper = object(rawPaper);
    if (!paper) continue;
    const sourceID =
      params.sourceByLegacyKey.get(legacyKey) ||
      params.sourceByLegacyKey.get(String(paper.paperKey || ""));
    const sourceIDs = sourceID ? [sourceID] : [];
    push(
      `paper:${legacyKey}:claims`,
      "claim-ledger",
      `${String(paper.title || legacyKey)} · Claim ledger`,
      paper.claimLedger,
      sourceIDs,
    );
    for (const [index, report] of (Array.isArray(paper.criticalReads)
      ? paper.criticalReads
      : []
    ).entries()) {
      push(
        `paper:${legacyKey}:methodology:${index}`,
        "methodology-audit",
        `${String(paper.title || legacyKey)} · Legacy methodology audit`,
        report,
        sourceIDs,
      );
    }
    for (const [index, report] of (Array.isArray(paper.reproducibilityReports)
      ? paper.reproducibilityReports
      : []
    ).entries()) {
      push(
        `paper:${legacyKey}:reproducibility:${index}`,
        "reproducibility",
        `${String(paper.title || legacyKey)} · Reproducibility`,
        report,
        sourceIDs,
      );
    }
    for (const [index, report] of (Array.isArray(paper.paperToCodeReports)
      ? paper.paperToCodeReports
      : []
    ).entries()) {
      push(
        `paper:${legacyKey}:paper-to-code:${index}`,
        "paper-to-code",
        `${String(paper.title || legacyKey)} · Paper-to-Code`,
        report,
        sourceIDs,
      );
    }
    push(
      `paper:${legacyKey}:mastery`,
      "paper-mastery",
      `${String(paper.title || legacyKey)} · Paper Mastery`,
      paper.mastery,
      sourceIDs,
    );
  }

  for (const [index, matrix] of (Array.isArray(params.state.matrices)
    ? params.state.matrices
    : []
  ).entries()) {
    push(
      `matrix:${index}`,
      "evidence-matrix",
      String(object(matrix)?.title || `Imported Evidence Matrix ${index + 1}`),
      matrix,
    );
  }
  for (const [index, graph] of (Array.isArray(params.state.graphs)
    ? params.state.graphs
    : []
  ).entries()) {
    push(
      `graph:${index}`,
      "relationship-graph",
      String(
        object(graph)?.title || `Imported Relationship Graph ${index + 1}`,
      ),
      graph,
    );
  }
  const crossPaperMastery = Array.isArray(params.state.crossPaperMastery)
    ? params.state.crossPaperMastery
    : [];
  const crossPaperQuestions = Array.isArray(params.state.crossPaperQuestions)
    ? params.state.crossPaperQuestions
    : [];
  const crossPaperAttempts = Array.isArray(params.state.crossPaperAttempts)
    ? params.state.crossPaperAttempts
    : [];
  if (
    crossPaperMastery.length ||
    crossPaperQuestions.length ||
    crossPaperAttempts.length
  ) {
    push(
      "cross-paper-mastery",
      "cross-paper-mastery",
      "Imported Cross-paper Mastery",
      {
        sessions: crossPaperMastery,
        questions: crossPaperQuestions,
        attempts: crossPaperAttempts,
      },
    );
  }
  const citationContexts = Array.isArray(params.state.citationContexts)
    ? params.state.citationContexts
    : [];
  const citationResults = Array.isArray(params.state.citationResults)
    ? params.state.citationResults
    : [];
  if (citationContexts.length || citationResults.length) {
    push("citation-stance", "citation-stance", "Imported Citation Stance", {
      contexts: citationContexts,
      results: citationResults,
    });
  }
  return descriptors;
}

function emptySummary(): ResearchWorkspaceLegacyMigrationSummary {
  return {
    migratedSources: 0,
    skippedSources: 0,
    detachedSources: 0,
    ambiguousSources: 0,
    artifactCounts: {},
    warnings: [],
  };
}

export class LegacyResearchWorkspaceImporter {
  private readonly files: SerializedResearchWorkspaceFiles;
  private readonly now: () => Date;
  private readonly resolver: LegacySourceResolver;

  constructor(
    private readonly options: LegacyResearchWorkspaceImporterOptions,
  ) {
    this.files = new SerializedResearchWorkspaceFiles(options.fileOps);
    this.now = options.now ?? (() => new Date());
    this.resolver = options.resolver ?? resolveLegacyZoteroSource;
  }

  get markerPath() {
    return pathJoin(this.options.rootDir, "migration", "v4-import.json");
  }

  private timestamp() {
    return this.now().toISOString();
  }

  private async readMarker() {
    return this.files.read(
      this.markerPath,
      parseResearchWorkspaceLegacyMigrationFile,
    );
  }

  async migrate(): Promise<LegacyResearchWorkspaceMigrationResult> {
    const existingMarker = await this.readMarker();
    if (!(await this.options.fileOps.exists(this.options.legacyPath))) {
      if (existingMarker?.migration.status === "completed") {
        return { status: "already-completed", marker: existingMarker };
      }
      if (existingMarker) {
        throw new Error(
          "Legacy Research Workspace disappeared before migration completed.",
        );
      }
      return { status: "not-found" };
    }
    const contents = await this.options.fileOps.readText(
      this.options.legacyPath,
    );
    if (contents === undefined) return { status: "not-found" };
    const legacyFingerprint = await fingerprintLegacyWorkspace(contents);
    if (existingMarker) {
      const markerFingerprint = existingMarker.migration.legacyFingerprint;
      if (
        markerFingerprint.algorithm !== legacyFingerprint.algorithm ||
        markerFingerprint.value !== legacyFingerprint.value
      ) {
        throw new Error(
          "Legacy Research Workspace changed after migration began; the original and imported data were preserved for manual review.",
        );
      }
      if (existingMarker.migration.status === "completed") {
        return { status: "already-completed", marker: existingMarker };
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      throw new Error(
        `Legacy Research Workspace contains invalid JSON: ${String(error)}`,
      );
    }
    const state = migrateResearchWorkspaceState(parsed);
    const root = object(parsed);
    const legacySchemaVersion = Number(root?.schemaVersion ?? 1);
    if (legacySchemaVersion > 4) {
      throw new Error(
        `Legacy Research Workspace schema ${legacySchemaVersion} is newer than supported schema 4.`,
      );
    }

    const startedAt = existingMarker?.migration.startedAt ?? this.timestamp();
    const projectID =
      existingMarker?.migration.createdProjectID ??
      `imported-${researchWorkspaceSourcePathID(
        `${legacyFingerprint.algorithm}:${legacyFingerprint.value}`,
      ).slice(0, 24)}`;
    let marker = existingMarker;
    if (!marker) {
      await this.files.ensureDirectory(
        pathJoin(this.options.rootDir, "migration"),
      );
      const initialMarker: ResearchWorkspaceLegacyMigrationFile = {
        schemaVersion: RESEARCH_WORKSPACE_MIGRATION_SCHEMA_VERSION,
        revision: 0,
        migration: {
          importerVersion: RESEARCH_WORKSPACE_LEGACY_IMPORTER_VERSION,
          status: "in-progress",
          legacyPath: this.options.legacyPath,
          legacyFingerprint,
          startedAt,
          createdProjectID: projectID,
          summary: emptySummary(),
        },
      };
      marker = await this.files.writeNew(this.markerPath, initialMarker);
    }
    if (!marker) throw new Error("Legacy migration marker was not created.");

    try {
      await this.options.repository.getProject(projectID);
    } catch (error) {
      if (!(error instanceof Error) || !/was not found/.test(error.message)) {
        throw error;
      }
      await this.options.repository.createProject({
        projectID,
        name: "Imported Research Workspace",
        description:
          "Non-destructive import of the former schema-4 Research Workspace.",
      });
    }

    const summary = emptySummary();
    const sourceByLegacyKey = new Map<string, string>();
    const sourceRecords = new Map<string, ResearchWorkspaceSourceRecord>();
    for (const [legacyKey, rawPaper] of Object.entries(
      object(state.papers) ?? {},
    )) {
      const paper = object(rawPaper);
      if (!paper) {
        summary.skippedSources += 1;
        continue;
      }
      const parsedSource =
        typeof paper.sourceID === "string"
          ? parseZoteroSourceID(paper.sourceID)
          : undefined;
      const itemKey = String(
        paper.itemKey || parsedSource?.itemKey || legacyKey,
      );
      const attachmentKey = String(
        paper.attachmentKey || parsedSource?.attachmentKey || "",
      );
      if (!itemKey || !attachmentKey) {
        summary.skippedSources += 1;
        summary.warnings.push(
          `Skipped ${String(paper.title || legacyKey)} because its legacy item or attachment key is missing.`,
        );
        continue;
      }
      const requestedLibraryID = Number(
        paper.libraryID || parsedSource?.libraryID || 0,
      );
      const candidates = await this.resolver({
        ...(requestedLibraryID > 0 ? { libraryID: requestedLibraryID } : {}),
        itemKey,
        attachmentKey,
      });
      const resolution =
        candidates.length === 1
          ? "resolved"
          : candidates.length > 1
            ? "ambiguous"
            : "detached";
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      const fingerprint = normalizeContentFingerprint(paper.contentFingerprint);
      const fallbackSourceID = `legacy:${researchWorkspaceSourcePathID(
        `${legacyFingerprint.value}:${legacyKey}:${itemKey}:${attachmentKey}`,
      )}`;
      const record: ResearchWorkspaceSourceRecord = candidate
        ? {
            sourceID: candidate.sourceID,
            identity: candidate.identity,
            title: String(paper.title || candidate.title),
            ...(candidate.creators ? { creators: candidate.creators } : {}),
            ...(candidate.year ? { year: candidate.year } : {}),
            ...(candidate.doi ? { doi: candidate.doi } : {}),
            ...(candidate.runtimeItemID
              ? { runtimeItemID: candidate.runtimeItemID }
              : {}),
            ...(candidate.runtimeAttachmentID
              ? { runtimeAttachmentID: candidate.runtimeAttachmentID }
              : {}),
            ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
            extractionQuality:
              paper.extractionQuality === "structured"
                ? "structured"
                : paper.extractionQuality === "zotero_text" ||
                    paper.extractionQuality === "plain_text"
                  ? "zotero_text"
                  : "unavailable",
            extractionNotes: [
              "Imported without a complete extraction lineage; rerun to refresh.",
            ],
            availability: candidate.availability,
            lastResolvedAt: this.timestamp(),
            ...(typeof paper.indexedAt === "string"
              ? { lastExtractedAt: paper.indexedAt }
              : {}),
            legacyIdentity: {
              paperKey: legacyKey,
              attachmentKey,
              resolution,
            },
          }
        : {
            sourceID: fallbackSourceID,
            identity: {
              libraryID: 0,
              itemKey,
              attachmentKey,
              standaloneAttachment: itemKey === attachmentKey,
            },
            title: String(paper.title || legacyKey),
            ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
            extractionQuality: "unavailable",
            extractionNotes: [
              resolution === "ambiguous"
                ? "Multiple Zotero libraries match the legacy keys; repair is required."
                : "No Zotero source matches the legacy keys; repair is required.",
            ],
            availability: "detached",
            lastResolvedAt: this.timestamp(),
            legacyIdentity: {
              paperKey: legacyKey,
              attachmentKey,
              resolution,
            },
          };
      if (resolution !== "resolved") summary.detachedSources += 1;
      if (resolution === "ambiguous") summary.ambiguousSources += 1;
      const existingSource = await this.options.repository.getSource(
        record.sourceID,
      );
      const persistedSource = existingSource?.source ?? record;
      if (existingSource) {
        summary.skippedSources += 1;
      } else {
        await this.options.repository.putSource(record);
        summary.migratedSources += 1;
      }
      sourceRecords.set(record.sourceID, persistedSource);
      for (const key of [
        legacyKey,
        String(paper.paperKey || ""),
        String(paper.sourceID || ""),
      ]) {
        if (key) sourceByLegacyKey.set(key, record.sourceID);
      }
    }

    const project = await this.options.repository.getProject(projectID);
    await this.options.repository.addMembers(
      projectID,
      project.membersRevision,
      [...sourceRecords.keys()].map((sourceID) => ({
        sourceID,
      })),
    );

    const preferences = await this.options.repository.getPreferences();
    const legacyPreferences = object(state.preferences);
    await this.options.repository.updatePreferences(
      preferences.revision,
      (current) => ({
        ...current,
        responseLanguage: ["English", "Korean", "Chinese"].includes(
          String(legacyPreferences?.responseLanguage),
        )
          ? (legacyPreferences?.responseLanguage as
              | "English"
              | "Korean"
              | "Chinese")
          : current.responseLanguage,
        maxPaperCharacters: Number.isFinite(
          Number(legacyPreferences?.maxPaperCharacters),
        )
          ? Math.max(
              10_000,
              Math.min(
                10_000_000,
                Math.floor(Number(legacyPreferences?.maxPaperCharacters)),
              ),
            )
          : current.maxPaperCharacters,
      }),
    );

    const allSourceIDs = [...sourceRecords.keys()];
    const descriptors = legacyArtifactDescriptors({
      state,
      sourceByLegacyKey,
      allSourceIDs,
    });
    for (const descriptor of descriptors) {
      const artifactID = `legacy-${descriptor.type}-${researchWorkspaceSourcePathID(
        `${legacyFingerprint.value}:${descriptor.key}`,
      ).slice(0, 24)}`;
      const existing = await this.options.repository.getArtifact(
        projectID,
        artifactID,
      );
      if (existing) {
        await this.options.repository.ensureArtifactReference(
          projectID,
          artifactID,
        );
      } else {
        await this.options.repository.createArtifact(projectID, {
          artifactID,
          type: descriptor.type,
          title: descriptor.title,
          status: "stale",
          sourceIDs: descriptor.sourceIDs,
          lineage: {
            inputs: descriptor.sourceIDs.map((sourceID) => ({
              sourceID,
              contentFingerprint:
                sourceRecords.get(sourceID)?.contentFingerprint?.value ??
                "legacy-unknown",
              contextProjectionFingerprint: "legacy-unknown",
            })),
            operation: LEGACY_ARTIFACT_OPERATIONS[descriptor.type],
            operationVersion: "legacy",
            promptVersion: "legacy-unknown",
            parserVersion: "legacy-unknown",
            evidenceVerifierVersion: "legacy-unverified",
            providerMode: "unknown",
            runID: `legacy-run-${researchWorkspaceSourcePathID(
              descriptor.key,
            ).slice(0, 24)}`,
          },
          payload: legacyArtifactPayload(descriptor),
          staleReasons: [
            "legacy-lineage-incomplete",
            "legacy-evidence-unverified",
            ...(descriptor.inferredScope
              ? ["legacy-source-scope-inferred"]
              : []),
          ],
          completedAt: this.timestamp(),
          supersedeLatest: false,
        });
      }
      summary.artifactCounts[descriptor.type] =
        (summary.artifactCounts[descriptor.type] ?? 0) + 1;
    }

    const completedAt = this.timestamp();
    const completed = await this.files.mutate({
      path: this.markerPath,
      parser: parseResearchWorkspaceLegacyMigrationFile,
      expectedRevision: marker.revision,
      mutate: (file) => ({
        ...file,
        migration: {
          ...file.migration,
          status: "completed" as const,
          completedAt,
          summary,
        },
      }),
    });
    return { status: "completed", marker: completed };
  }
}
