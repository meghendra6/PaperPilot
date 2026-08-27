"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESEARCH_WORKSPACE_SCHEMA_VERSION = void 0;
exports.createResearchWorkspaceState = createResearchWorkspaceState;
exports.migrateResearchWorkspaceState = migrateResearchWorkspaceState;
exports.summarizeResearchWorkspace = summarizeResearchWorkspace;
exports.RESEARCH_WORKSPACE_SCHEMA_VERSION = 3;
function createResearchWorkspaceState(now = new Date().toISOString()) {
    return {
        schemaVersion: 3,
        revision: 0,
        papers: {}, matrices: [], graphs: [], crossPaperMastery: [], crossPaperQuestions: [], crossPaperAttempts: [],
        citationContexts: [], citationResults: [], monitors: [], monitorRuns: [],
        preferences: { provider: "codex", executables: { codex: "codex", claude: "claude", gemini: "gemini" }, responseLanguage: "English", maxPaperCharacters: 1500000 },
        createdAt: now, updatedAt: now,
    };
}
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
function papers(value) {
    const raw = object(value);
    if (!raw)
        return {};
    const result = {};
    for (const [key, entry] of Object.entries(raw)) {
        const item = object(entry);
        if (!item)
            continue;
        const title = typeof item.title === "string" ? item.title : key;
        const attachmentKey = typeof item.attachmentKey === "string" ? item.attachmentKey : "";
        result[key] = {
            paperKey: typeof item.paperKey === "string" ? item.paperKey : key,
            ...(typeof item.itemID === "number" ? { itemID: item.itemID } : {}), attachmentKey, title,
            extractionQuality: item.extractionQuality === "structured" || item.extractionQuality === "zotero_text" || item.extractionQuality === "plain_text" ? item.extractionQuality : "unavailable",
            ...(typeof item.indexedAt === "string" ? { indexedAt: item.indexedAt } : {}),
            ...(item.claimLedger ? { claimLedger: item.claimLedger } : {}),
            ...(item.mastery ? { mastery: item.mastery } : {}),
            criticalReads: Array.isArray(item.criticalReads) ? item.criticalReads : [],
            reproducibilityReports: Array.isArray(item.reproducibilityReports) ? item.reproducibilityReports : [],
            paperToCodeReports: Array.isArray(item.paperToCodeReports) ? item.paperToCodeReports : [],
        };
    }
    return result;
}
function migrateResearchWorkspaceState(value, now = new Date().toISOString()) {
    const base = createResearchWorkspaceState(now);
    const root = object(value);
    if (!root)
        return base;
    const persistedSchemaVersion = Number(root.schemaVersion ?? 1);
    if (Number.isFinite(persistedSchemaVersion) && persistedSchemaVersion > exports.RESEARCH_WORKSPACE_SCHEMA_VERSION) {
        throw new Error(`Research Workspace schema ${persistedSchemaVersion} is newer than supported schema ${exports.RESEARCH_WORKSPACE_SCHEMA_VERSION}.`);
    }
    const prefs = object(root.preferences);
    const executables = object(prefs?.executables);
    const provider = prefs?.provider === "claude" || prefs?.provider === "gemini" || prefs?.provider === "codex" ? prefs.provider : base.preferences.provider;
    const revision = Number.isFinite(Number(root.revision)) ? Math.max(0, Math.floor(Number(root.revision))) : 0;
    return {
        ...base,
        revision,
        papers: papers(root.papers),
        matrices: Array.isArray(root.matrices) ? root.matrices : [],
        graphs: Array.isArray(root.graphs) ? root.graphs : [],
        crossPaperMastery: Array.isArray(root.crossPaperMastery) ? root.crossPaperMastery : [],
        crossPaperQuestions: Array.isArray(root.crossPaperQuestions) ? root.crossPaperQuestions : [],
        crossPaperAttempts: Array.isArray(root.crossPaperAttempts) ? root.crossPaperAttempts : [],
        citationContexts: Array.isArray(root.citationContexts) ? root.citationContexts : [],
        citationResults: Array.isArray(root.citationResults) ? root.citationResults : [],
        monitors: Array.isArray(root.monitors) ? root.monitors : [],
        monitorRuns: Array.isArray(root.monitorRuns) ? root.monitorRuns : [],
        preferences: {
            provider,
            executables: {
                codex: typeof executables?.codex === "string" ? executables.codex : "codex",
                claude: typeof executables?.claude === "string" ? executables.claude : "claude",
                gemini: typeof executables?.gemini === "string" ? executables.gemini : "gemini",
            },
            responseLanguage: typeof prefs?.responseLanguage === "string" && prefs.responseLanguage.trim() ? prefs.responseLanguage.trim() : "English",
            maxPaperCharacters: Number.isFinite(Number(prefs?.maxPaperCharacters)) ? Math.max(10000, Math.min(10000000, Number(prefs?.maxPaperCharacters))) : 1500000,
        },
        createdAt: typeof root.createdAt === "string" ? root.createdAt : now,
        updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : now,
    };
}
function summarizeResearchWorkspace(state) {
    return {
        paperCount: Object.keys(state.papers).length,
        matrixCount: state.matrices.length,
        graphCount: state.graphs.length,
        monitorCount: state.monitors.filter((monitor) => monitor.enabled).length,
        openMasteryReviews: Object.values(state.papers).filter((paper) => paper.mastery && !paper.mastery.completedAt).length,
    };
}
