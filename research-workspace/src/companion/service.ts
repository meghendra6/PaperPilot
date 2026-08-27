"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearchWorkspaceService = void 0;
const platform_1 = __require("src/companion/platform.ts");
const indexExports_1 = __require("src/modules/context/hybrid/indexExports.ts");
const claimExtraction_1 = __require("src/modules/evidence/claimExtraction.ts");
const detector_1 = __require("src/modules/criticalRead/profiled/detector.ts");
const profiles_1 = __require("src/modules/criticalRead/profiled/profiles.ts");
const prompt_1 = __require("src/modules/criticalRead/profiled/prompt.ts");
const parser_1 = __require("src/modules/criticalRead/profiled/parser.ts");
const prompt_2 = __require("src/modules/reproducibility/prompt.ts");
const parser_2 = __require("src/modules/reproducibility/parser.ts");
const export_1 = __require("src/modules/reproducibility/export.ts");
const prompt_3 = __require("src/modules/paperToCode/prompt.ts");
const parser_3 = __require("src/modules/paperToCode/parser.ts");
const export_2 = __require("src/modules/paperToCode/export.ts");
const engine_1 = __require("src/modules/evidenceMatrix/engine.ts");
const prompt_4 = __require("src/modules/evidenceMatrix/prompt.ts");
const parser_4 = __require("src/modules/evidenceMatrix/parser.ts");
const export_3 = __require("src/modules/evidenceMatrix/export.ts");
const prompt_5 = __require("src/modules/literatureGraph/prompt.ts");
const parser_5 = __require("src/modules/literatureGraph/parser.ts");
const export_4 = __require("src/modules/literatureGraph/export.ts");
const engine_2 = __require("src/modules/crossPaperMastery/engine.ts");
const prompt_6 = __require("src/modules/crossPaperMastery/prompt.ts");
const parser_6 = __require("src/modules/crossPaperMastery/parser.ts");
const prompt_7 = __require("src/modules/citationStance/prompt.ts");
const parser_7 = __require("src/modules/citationStance/parser.ts");
const engine_3 = __require("src/modules/citationStance/engine.ts");
const engine_4 = __require("src/modules/researchMonitor/engine.ts");
const prompt_8 = __require("src/modules/researchMonitor/prompt.ts");
const parser_8 = __require("src/modules/researchMonitor/parser.ts");
const controller_1 = __require("src/modules/comprehensionCheck/v2/controller.ts");
const viewModel_1 = __require("src/modules/comprehensionCheck/v2/viewModel.ts");
const evidenceTypes_1 = __require("src/modules/evidence/types.ts");
const DEFAULT_COLUMNS = [
    { id: "contribution", label: "Main contribution", extractionQuestion: "What is the paper's main contribution relative to prior work?", question: "What is the paper's main contribution relative to prior work?", valueType: "text", requiredEvidence: true },
    { id: "method", label: "Method", extractionQuestion: "What method or mechanism is proposed?", question: "What method or mechanism is proposed?", valueType: "text", requiredEvidence: true },
    { id: "dataset", label: "Datasets / workloads", extractionQuestion: "Which datasets, benchmarks, or workloads are used?", question: "Which datasets, benchmarks, or workloads are used?", valueType: "list", requiredEvidence: true },
    { id: "hardware", label: "Hardware", extractionQuestion: "What hardware and system configuration is reported?", question: "What hardware and system configuration is reported?", valueType: "text", requiredEvidence: true },
    { id: "primary_metric", label: "Primary metric", extractionQuestion: "What is the primary reported evaluation metric or result?", question: "What is the primary reported evaluation metric or result?", valueType: "text", requiredEvidence: true },
    { id: "limitation", label: "Limitation", extractionQuestion: "What limitation, threat to validity, or unsupported scope is stated or directly evidenced?", question: "What limitation, threat to validity, or unsupported scope is stated or directly evidenced?", valueType: "text", requiredEvidence: true },
    { id: "code", label: "Code available", extractionQuestion: "Does the paper provide an official code or artifact URL?", question: "Does the paper provide an official code or artifact URL?", valueType: "boolean", requiredEvidence: true },
];
function id(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function now() { return new Date().toISOString(); }
function normalizeLanguage(value) { return value.trim() || "English"; }
function sourceFingerprint(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${value.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
class ResearchWorkspaceService {
    constructor(env) {
        this.env = env;
        this.indexes = new Map();
    }
    async state() { return this.env.repository.load(); }
    async configure(input) {
        return this.env.repository.update((state) => {
            if (input.provider && !["codex", "claude", "gemini"].includes(input.provider))
                throw new Error(`Unsupported AI provider: ${input.provider}`);
            if (input.provider)
                state.preferences.provider = input.provider;
            if (input.executable?.trim())
                state.preferences.executables[state.preferences.provider] = input.executable.trim();
            if (input.responseLanguage !== undefined)
                state.preferences.responseLanguage = normalizeLanguage(input.responseLanguage);
            if (input.maxPaperCharacters !== undefined && Number.isFinite(Number(input.maxPaperCharacters))) {
                state.preferences.maxPaperCharacters = Math.max(10000, Math.min(10000000, Math.floor(Number(input.maxPaperCharacters))));
            }
        });
    }
    async run(prompt, purpose, webSearch = false) {
        const state = await this.state();
        const provider = state.preferences.provider;
        const paths = (0, platform_1.makeRunPaths)(purpose);
        return this.env.agent.run(prompt, {
            provider,
            executable: state.preferences.executables[provider],
            runDirectory: paths.directory,
            promptPath: paths.promptPath,
            purpose,
            webSearch,
        });
    }
    async registerPaper(paper) {
        this.indexPaper(paper);
        return this.env.repository.update((state) => {
            const previous = state.papers[paper.paperKey];
            state.papers[paper.paperKey] = {
                paperKey: paper.paperKey,
                itemID: paper.itemID,
                attachmentKey: paper.attachmentKey,
                title: paper.title,
                extractionQuality: paper.extractionQuality,
                indexedAt: now(),
                ...(previous?.claimLedger ? { claimLedger: previous.claimLedger } : {}),
                ...(previous?.mastery ? { mastery: previous.mastery } : {}),
                criticalReads: previous?.criticalReads ?? [],
                reproducibilityReports: previous?.reproducibilityReports ?? [],
                paperToCodeReports: previous?.paperToCodeReports ?? [],
            };
        });
    }
    indexPaper(paper) {
        const key = `${paper.paperKey}:${paper.attachmentKey}`;
        const existing = this.indexes.get(key);
        if (existing?.source === paper.context)
            return existing.index;
        const fingerprint = sourceFingerprint(paper.context);
        const index = (0, indexExports_1.buildHybridIndex)({
            paperKey: paper.paperKey,
            attachmentKey: paper.attachmentKey,
            sourceFingerprint: fingerprint,
            chunks: (0, indexExports_1.chunkPaperDocument)({ paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, text: paper.context }),
        });
        this.indexes.set(key, { source: paper.context, index });
        return index;
    }
    searchPaper(paper, query) {
        return (0, indexExports_1.searchHybridIndex)(this.indexPaper(paper), query, { topK: 6 });
    }
    async extractClaims(paper) {
        const state = await this.state();
        const response = await this.run((0, claimExtraction_1.buildClaimExtractionPrompt)({ paperContext: paper.context, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, responseLanguage: state.preferences.responseLanguage }), "claim-extraction");
        const ledger = (0, claimExtraction_1.parseClaimExtractionResponse)({ response, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey });
        await this.env.repository.update((next) => { const record = next.papers[paper.paperKey]; if (!record)
            throw new Error("Paper is not registered."); record.claimLedger = ledger; });
        return ledger;
    }
    async runCriticalRead(paper) {
        const state = await this.state();
        const detection = (0, detector_1.detectCriticalReadProfile)(paper.context);
        const profile = (0, profiles_1.getCriticalReadProfile)(detection.primary);
        const response = await this.run((0, prompt_1.buildProfiledCriticalReadPrompt)({ paperContext: paper.context, profile, attachmentKey: paper.attachmentKey, responseLanguage: state.preferences.responseLanguage }), `critical-read-${profile.id}`);
        const report = (0, parser_1.parseProfiledCriticalReadResponse)({ response, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, profile: profile.id });
        await this.env.repository.update((next) => { next.papers[paper.paperKey].criticalReads.push(report); });
        return { detection, report };
    }
    async runReproducibility(paper) {
        const state = await this.state();
        const response = await this.run((0, prompt_2.buildReproducibilityPrompt)({ paperContext: paper.context, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, responseLanguage: state.preferences.responseLanguage }), "reproducibility-audit");
        const report = (0, parser_2.parseReproducibilityResponse)({ response, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey });
        await this.env.repository.update((next) => { next.papers[paper.paperKey].reproducibilityReports.push(report); });
        return report;
    }
    async runPaperToCode(paper) {
        const state = await this.state();
        const response = await this.run((0, prompt_3.buildPaperToCodePrompt)({ paperContext: paper.context, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, responseLanguage: state.preferences.responseLanguage }), "paper-to-code");
        const report = (0, parser_3.parsePaperToCodeResponse)({ response, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey });
        await this.env.repository.update((next) => { next.papers[paper.paperKey].paperToCodeReports.push(report); });
        return report;
    }
    masteryController(paper) {
        return new controller_1.MasteryV2Controller({
            agent: { run: (prompt, purpose) => this.run(prompt, purpose) },
            persistence: {
                load: async (paperKey) => (await this.state()).papers[paperKey]?.mastery ?? null,
                save: async (session) => { await this.env.repository.update((state) => { if (!state.papers[session.paperKey])
                    throw new Error("Paper is not registered."); state.papers[session.paperKey].mastery = session; }); },
            },
            clock: { now: () => new Date() },
            idFactory: { next: (prefix) => id(prefix) },
            maxStructuredOutputAttempts: 2,
        });
    }
    async startOrResumeMastery(paper) {
        const state = await this.state();
        const controller = this.masteryController(paper);
        let session = await controller.load(paper.paperKey);
        if (!session || session.phase === "abandoned") {
            session = await controller.start({ paperKey: paper.paperKey, paperTitle: paper.title, attachmentKey: paper.attachmentKey, paperContext: paper.context, responseLanguage: state.preferences.responseLanguage, maxConcepts: 12 });
        }
        session = await controller.ensureQuestion(session, paper.context);
        return { session, question: (0, viewModel_1.toLearnerQuestionView)(session), dashboard: (0, viewModel_1.toMasteryDashboardView)(session) };
    }
    async submitMastery(paper, answer, confidence) {
        const controller = this.masteryController(paper);
        const session = await controller.load(paper.paperKey);
        if (!session)
            throw new Error("Start Paper Mastery first.");
        const next = await controller.submit(session, { paperContext: paper.context, answer, learnerConfidence: confidence });
        const feedback = next.attempts.length ? (0, viewModel_1.toLearnerAttemptFeedback)(next.attempts[next.attempts.length - 1]) : null;
        const withQuestion = next.phase === "active" ? await controller.ensureQuestion(next, paper.context) : next;
        return { session: withQuestion, feedback, question: (0, viewModel_1.toLearnerQuestionView)(withQuestion), dashboard: (0, viewModel_1.toMasteryDashboardView)(withQuestion) };
    }
    async createEvidenceMatrix(papers) {
        if (papers.length < 2)
            throw new Error("Select at least two papers in the Zotero item list.");
        const state = await this.state();
        let matrix = (0, engine_1.createEvidenceMatrix)({ id: id("matrix"), title: `Evidence Matrix · ${new Date().toLocaleDateString()}`, columns: DEFAULT_COLUMNS, papers: papers.map((paper) => ({ paperKey: paper.paperKey, title: paper.title, attachmentKeys: [paper.attachmentKey] })) });
        for (const paper of papers) {
            const response = await this.run((0, prompt_4.buildEvidenceMatrixExtractionPrompt)({ paperContext: paper.context, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, columns: matrix.columns, responseLanguage: state.preferences.responseLanguage }), `matrix-${paper.paperKey}`);
            const row = (0, parser_4.parseEvidenceMatrixRowResponse)({ response, paperKey: paper.paperKey, attachmentKey: paper.attachmentKey, columns: matrix.columns });
            matrix = (0, engine_1.upsertEvidenceMatrixRow)(matrix, row);
        }
        await this.env.repository.update((next) => { next.matrices = [...next.matrices.filter((entry) => entry.id !== matrix.id), matrix]; });
        return { matrix, coverage: (0, engine_1.calculateEvidenceMatrixCoverage)(matrix) };
    }
    async createLiteratureGraph(papers) {
        if (papers.length < 2)
            throw new Error("Select at least two papers in the Zotero item list.");
        const state = await this.state();
        const response = await this.run((0, prompt_5.buildLiteratureGraphPrompt)({ papers: papers.map((paper) => ({ paperKey: paper.paperKey, title: paper.title, context: paper.context })), responseLanguage: state.preferences.responseLanguage }), "literature-graph");
        const graph = (0, parser_5.parseLiteratureGraphResponse)({ response, id: id("graph"), title: `Literature Graph · ${new Date().toLocaleDateString()}`, allowedPaperKeys: new Set(papers.map((paper) => paper.paperKey)), allowedAttachmentKeys: new Set(papers.map((paper) => paper.attachmentKey)) });
        await this.env.repository.update((next) => { next.graphs = [...next.graphs.filter((entry) => entry.id !== graph.id), graph]; });
        return graph;
    }
    async startCrossPaperMastery(papers) {
        if (papers.length < 2)
            throw new Error("Select at least two papers in the Zotero item list.");
        const state = await this.state();
        const concept = { id: id("cross-concept"), label: "Cross-paper synthesis", paperKeys: papers.map((paper) => paper.paperKey), importance: "core", description: "Compare mechanisms, evidence, limitations, and transfer across selected papers." };
        let session = (0, engine_2.createCrossPaperMasterySession)({ id: id("cross-session"), collectionKey: "selected-items", concepts: [concept] });
        const response = await this.run((0, prompt_6.buildCrossPaperQuestionPrompt)({ papers: papers.map((paper) => ({ paperKey: paper.paperKey, title: paper.title, context: paper.context })), responseLanguage: state.preferences.responseLanguage }), "cross-paper-question");
        const question = (0, parser_6.parseCrossPaperQuestionResponse)({ response, id: id("cross-question"), concept, allowedPaperKeys: new Set(concept.paperKeys), allowedAttachmentKeys: new Set(papers.map((paper) => paper.attachmentKey)) });
        session = (0, engine_2.addCrossPaperQuestion)(session, question);
        await this.env.repository.update((next) => { next.crossPaperMastery.push(session); next.crossPaperQuestions.push(question); });
        return { session, question };
    }
    async submitCrossPaperMastery(sessionId, papers, answer, learnerConfidence) {
        const state = await this.state();
        let session = state.crossPaperMastery.find((entry) => entry.id === sessionId);
        if (!session)
            throw new Error("Cross-paper session not found.");
        const question = session.questions[session.questions.length - 1];
        const response = await this.run((0, prompt_6.buildCrossPaperGradePrompt)({ question, answer, paperContexts: papers.map((paper) => ({ paperKey: paper.paperKey, context: paper.context })), responseLanguage: state.preferences.responseLanguage }), "cross-paper-grade");
        const parsed = (0, parser_6.parseCrossPaperGradeResponse)({ response, id: id("cross-attempt"), question, answer, learnerConfidence, allowedAttachmentKeys: new Set(papers.map((paper) => paper.attachmentKey)) });
        session = (0, engine_2.addCrossPaperAttempt)(session, parsed);
        const grade = { questionId: question.id, scores: parsed.grades, totalScore: parsed.grades.reduce((sum, entry) => sum + entry.score, 0), maxScore: parsed.grades.reduce((sum, entry) => sum + entry.maxScore, 0), feedback: parsed.grades.map((entry) => entry.feedback).filter(Boolean).join("\n"), misconceptions: parsed.misconceptions, graderConfidence: parsed.graderConfidence };
        await this.env.repository.update((next) => { next.crossPaperMastery = next.crossPaperMastery.map((entry) => entry.id === session.id ? session : entry); next.crossPaperAttempts.push(parsed); });
        return { session, grade, summary: (0, engine_2.summarizeCrossPaperMastery)(session) };
    }
    async classifyCitationContexts(contexts) {
        if (!Array.isArray(contexts) || contexts.length === 0)
            throw new Error("Citation input must contain at least one context.");
        const seen = new Set();
        const normalizedContexts = contexts.map((context, index) => {
            if (!context || typeof context !== "object" || Array.isArray(context))
                throw new Error(`Citation context ${index + 1} must be an object.`);
            const id = String(context.id ?? "").trim();
            const citingPaperKey = String(context.citingPaperKey ?? "").trim();
            const citedPaperKey = String(context.citedPaperKey ?? "").trim();
            const text = String(context.context ?? "").trim();
            if (!id || seen.has(id))
                throw new Error(`Missing or duplicate citation context ${id}`);
            if (!citingPaperKey || !citedPaperKey || !text)
                throw new Error(`Citation context ${id} requires citingPaperKey, citedPaperKey, and context.`);
            seen.add(id);
            return { ...context, id, citingPaperKey, citedPaperKey, context: text, evidence: (0, evidenceTypes_1.normalizeEvidenceReferences)(context.evidence) };
        });
        const state = await this.state();
        const response = await this.run((0, prompt_7.buildCitationStancePrompt)(normalizedContexts, state.preferences.responseLanguage), "citation-stance");
        const results = (0, parser_7.parseCitationStanceResponse)({ response, contexts: normalizedContexts, allowedAttachments: [...new Set(normalizedContexts.flatMap((context) => context.evidence.map((entry) => entry.attachmentKey)))] });
        await this.env.repository.update((next) => { next.citationContexts.push(...normalizedContexts); next.citationResults.push(...results); });
        return { results, summary: (0, engine_3.summarizeCitationStances)(results) };
    }
    async addMonitor(name, query, cadenceDays = 7) {
        const monitor = (0, engine_4.createResearchMonitorQuery)({ id: id("monitor"), name, query, cadence: "custom", cadenceDays });
        await this.env.repository.update((state) => { state.monitors.push(monitor); });
        return monitor;
    }
    async runMonitor(monitorId) {
        const state = await this.state();
        const monitor = state.monitors.find((entry) => entry.id === monitorId);
        if (!monitor)
            throw new Error("Research monitor not found.");
        const startedAt = now();
        const discovery = await this.run((0, prompt_8.buildMonitorDiscoveryPrompt)({ query: monitor.query, knownTitles: Object.values(state.papers).map((paper) => paper.title), language: state.preferences.responseLanguage }), "research-monitor-discovery", true);
        const candidates = (0, parser_8.parseMonitorDiscoveryResponse)(discovery, monitor.seenIdentifiers);
        const ranking = await this.run((0, prompt_8.buildMonitorRankingPrompt)({ query: monitor.query, candidates, collectionSummary: Object.values(state.papers).map((paper) => paper.title).join(" | "), language: state.preferences.responseLanguage }), "research-monitor-ranking");
        const ranked = (0, parser_8.parseMonitorRankingResponse)(ranking, candidates);
        const run = { id: id("monitor-run"), queryId: monitor.id, startedAt, finishedAt: now(), candidates: ranked, rejectedCount: Math.max(0, candidates.length - ranked.length) };
        const updated = (0, engine_4.markResearchMonitorRun)(monitor, ranked.map(engine_4.candidateIdentifier));
        await this.env.repository.update((next) => { next.monitors = next.monitors.map((entry) => entry.id === monitor.id ? updated : entry); next.monitorRuns.push(run); });
        return run;
    }
    async exportWorkspace() {
        const state = await this.state();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const jsonPath = await this.env.exportTextFile(`research-workspace-${stamp}.json`, `${JSON.stringify(state, null, 2)}\n`);
        const lines = ["# PaperPilot Research Workspace", "", `Exported: ${now()}`, "", `Papers: ${Object.keys(state.papers).length}`, `Matrices: ${state.matrices.length}`, `Graphs: ${state.graphs.length}`, `Monitors: ${state.monitors.length}`, ""];
        for (const paper of Object.values(state.papers)) {
            lines.push(`## ${paper.title}`, "", `- Extraction: ${paper.extractionQuality}`, `- Critical reads: ${paper.criticalReads.length}`, `- Reproducibility reports: ${paper.reproducibilityReports.length}`, `- Paper-to-Code reports: ${paper.paperToCodeReports.length}`, `- Mastery attempts: ${paper.mastery?.attempts.length ?? 0}`, "");
            const repro = paper.reproducibilityReports[paper.reproducibilityReports.length - 1];
            if (repro)
                lines.push((0, export_1.exportReproducibilityMarkdown)(repro), "");
            const code = paper.paperToCodeReports[paper.paperToCodeReports.length - 1];
            if (code)
                lines.push((0, export_2.exportPaperToCodeMarkdown)(code), "");
        }
        for (const matrix of state.matrices)
            lines.push((0, export_3.exportEvidenceMatrixMarkdown)(matrix), "", "```csv", (0, export_3.exportEvidenceMatrixCsv)(matrix), "```", "");
        for (const graph of state.graphs)
            lines.push("```mermaid", (0, export_4.exportLiteratureGraphMermaid)(graph), "```", "");
        const markdownPath = await this.env.exportTextFile(`research-workspace-${stamp}.md`, `${lines.join("\n")}\n`);
        return { jsonPath, markdownPath };
    }
}
exports.ResearchWorkspaceService = ResearchWorkspaceService;
