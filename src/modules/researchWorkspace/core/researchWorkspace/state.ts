const RESEARCH_WORKSPACE_SCHEMA_VERSION = 4;
export interface ResearchWorkspaceCorePaperState {
  sourceID: string;
  paperKey: string;
  attachmentKey: string;
  title: string;
  extractionQuality:
    | "structured"
    | "zotero_text"
    | "plain_text"
    | "unavailable";
  mastery?: { completedAt?: string };
  [key: string]: unknown;
}

export interface ResearchWorkspaceCoreState {
  schemaVersion: number;
  revision: number;
  papers: Record<string, ResearchWorkspaceCorePaperState>;
  matrices: unknown[];
  graphs: unknown[];
  crossPaperMastery: unknown[];
  crossPaperQuestions: unknown[];
  crossPaperAttempts: unknown[];
  citationContexts: unknown[];
  citationResults: unknown[];
  preferences: { responseLanguage: string; maxPaperCharacters: number };
  createdAt: string;
  updatedAt: string;
}

function createResearchWorkspaceState(
  now = new Date().toISOString(),
): ResearchWorkspaceCoreState {
  return {
    schemaVersion: RESEARCH_WORKSPACE_SCHEMA_VERSION,
    revision: 0,
    papers: {},
    matrices: [],
    graphs: [],
    crossPaperMastery: [],
    crossPaperQuestions: [],
    crossPaperAttempts: [],
    citationContexts: [],
    citationResults: [],
    preferences: {
      responseLanguage: "English",
      maxPaperCharacters: 1500000,
    },
    createdAt: now,
    updatedAt: now,
  };
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function contentFingerprint(value: unknown) {
  if (typeof value === "string" && value) {
    return {
      algorithm: "zotero-version-mtime-size-v1",
      value,
    };
  }
  const item = object(value);
  if (!item || typeof item.value !== "string" || !item.value) return undefined;
  const algorithm =
    item.algorithm === "sha256" ||
    item.algorithm === "zotero-version-mtime-size-v1"
      ? item.algorithm
      : "zotero-version-mtime-size-v1";
  return {
    algorithm,
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
function papers(
  value: unknown,
): Record<string, ResearchWorkspaceCorePaperState> {
  const raw = object(value);
  if (!raw) return {};
  const result: Record<string, ResearchWorkspaceCorePaperState> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const item = object(entry);
    if (!item) continue;
    const title = typeof item.title === "string" ? item.title : key;
    const attachmentKey =
      typeof item.attachmentKey === "string" ? item.attachmentKey : "";
    const fingerprint = contentFingerprint(item.contentFingerprint);
    result[key] = {
      sourceID:
        typeof item.sourceID === "string"
          ? item.sourceID
          : typeof item.paperKey === "string"
            ? item.paperKey
            : key,
      paperKey: typeof item.paperKey === "string" ? item.paperKey : key,
      ...(typeof item.libraryID === "number"
        ? { libraryID: item.libraryID }
        : {}),
      ...(typeof item.itemKey === "string" ? { itemKey: item.itemKey } : {}),
      ...(typeof item.itemID === "number" ? { itemID: item.itemID } : {}),
      ...(typeof item.attachmentID === "number"
        ? { attachmentID: item.attachmentID }
        : {}),
      attachmentKey,
      ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
      ...(typeof item.sourceStaleAt === "string"
        ? { sourceStaleAt: item.sourceStaleAt }
        : {}),
      ...(typeof item.sourceStaleReason === "string"
        ? { sourceStaleReason: item.sourceStaleReason }
        : {}),
      title,
      extractionQuality:
        item.extractionQuality === "structured" ||
        item.extractionQuality === "zotero_text" ||
        item.extractionQuality === "plain_text"
          ? item.extractionQuality
          : "unavailable",
      ...(typeof item.indexedAt === "string"
        ? { indexedAt: item.indexedAt }
        : {}),
      ...(item.claimLedger ? { claimLedger: item.claimLedger } : {}),
      ...(item.mastery ? { mastery: item.mastery } : {}),
      criticalReads: Array.isArray(item.criticalReads)
        ? item.criticalReads
        : [],
      reproducibilityReports: Array.isArray(item.reproducibilityReports)
        ? item.reproducibilityReports
        : [],
      paperToCodeReports: Array.isArray(item.paperToCodeReports)
        ? item.paperToCodeReports
        : [],
    };
  }
  return result;
}
function migrateResearchWorkspaceState(
  value: unknown,
  now = new Date().toISOString(),
): ResearchWorkspaceCoreState {
  const base = createResearchWorkspaceState(now);
  const root = object(value);
  if (!root) return base;
  const persistedSchemaVersion = Number(root.schemaVersion ?? 1);
  if (
    Number.isFinite(persistedSchemaVersion) &&
    persistedSchemaVersion > RESEARCH_WORKSPACE_SCHEMA_VERSION
  ) {
    throw new Error(
      `Research Workspace schema ${persistedSchemaVersion} is newer than supported schema ${RESEARCH_WORKSPACE_SCHEMA_VERSION}.`,
    );
  }
  const prefs = object(root.preferences);
  const revision = Number.isFinite(Number(root.revision))
    ? Math.max(0, Math.floor(Number(root.revision)))
    : 0;
  return {
    ...base,
    revision,
    papers: papers(root.papers),
    matrices: Array.isArray(root.matrices) ? root.matrices : [],
    graphs: Array.isArray(root.graphs) ? root.graphs : [],
    crossPaperMastery: Array.isArray(root.crossPaperMastery)
      ? root.crossPaperMastery
      : [],
    crossPaperQuestions: Array.isArray(root.crossPaperQuestions)
      ? root.crossPaperQuestions
      : [],
    crossPaperAttempts: Array.isArray(root.crossPaperAttempts)
      ? root.crossPaperAttempts
      : [],
    citationContexts: Array.isArray(root.citationContexts)
      ? root.citationContexts
      : [],
    citationResults: Array.isArray(root.citationResults)
      ? root.citationResults
      : [],
    preferences: {
      responseLanguage:
        typeof prefs?.responseLanguage === "string" &&
        prefs.responseLanguage.trim()
          ? prefs.responseLanguage.trim()
          : "English",
      maxPaperCharacters: Number.isFinite(Number(prefs?.maxPaperCharacters))
        ? Math.max(10000, Math.min(10000000, Number(prefs?.maxPaperCharacters)))
        : 1500000,
    },
    createdAt: typeof root.createdAt === "string" ? root.createdAt : now,
    updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : now,
  };
}
function summarizeResearchWorkspace(state: ResearchWorkspaceCoreState) {
  return {
    paperCount: Object.keys(state.papers).length,
    matrixCount: state.matrices.length,
    graphCount: state.graphs.length,
    openMasteryReviews: Object.values(state.papers).filter(
      (paper) => paper.mastery && !paper.mastery.completedAt,
    ).length,
  };
}

export {
  createResearchWorkspaceState,
  migrateResearchWorkspaceState,
  summarizeResearchWorkspace,
  RESEARCH_WORKSPACE_SCHEMA_VERSION,
};
