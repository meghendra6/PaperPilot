"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderResearchWorkspaceView = renderResearchWorkspaceView;
const platform_1 = __require("src/companion/platform.ts");
const types_1 = __require("src/modules/evidence/types.ts");
const readiness_1 = __require("src/modules/reproducibility/readiness.ts");
const graph_1 = __require("src/modules/literatureGraph/graph.ts");
const HTML_NS = "http://www.w3.org/1999/xhtml";
const runtime = new WeakMap();
function element(doc, tag, className, text) {
    const node = doc.createElementNS(HTML_NS, tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function button(doc, text, action, className = "pprw-button") {
    const node = element(doc, "button", className, text);
    node.type = "button";
    node.addEventListener("click", () => void action());
    return node;
}
function input(doc, placeholder, value = "") {
    const node = element(doc, "input", "pprw-input");
    node.type = "text";
    node.placeholder = placeholder;
    node.value = value;
    return node;
}
function textarea(doc, placeholder, rows = 5) {
    const node = element(doc, "textarea", "pprw-textarea");
    node.placeholder = placeholder;
    node.rows = rows;
    return node;
}
function details(doc, title, open = false) {
    const root = element(doc, "details", "pprw-section");
    root.open = open;
    root.append(element(doc, "summary", "pprw-section-title", title));
    const content = element(doc, "div", "pprw-section-content");
    root.append(content);
    return { root, content };
}
function row(doc) { return element(doc, "div", "pprw-row"); }
function formatPercent(value) { const n = Number(value); return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—"; }
function safeStringify(value) {
    try {
        const seen = new WeakSet();
        return JSON.stringify(value, (_key, entry) => {
            if (!entry || typeof entry !== "object")
                return entry;
            if (seen.has(entry))
                return "[Circular]";
            seen.add(entry);
            return entry;
        }, 2);
    }
    catch {
        return String(value);
    }
}
function isCurrent(root, generation) {
    return generation === undefined || runtime.get(root)?.generation === generation;
}
function status(root, message, kind = "info", generation) {
    if (!isCurrent(root, generation))
        return;
    const node = root.querySelector(".pprw-status");
    if (!node)
        return;
    node.textContent = message;
    node.dataset.kind = kind;
}
function setBusy(root, busy, generation) {
    if (!isCurrent(root, generation))
        return;
    const current = runtime.get(root) || { busy: false };
    current.busy = busy;
    runtime.set(root, current);
    for (const node of root.querySelectorAll("button, input, select, textarea"))
        node.disabled = busy;
    root.classList.toggle("is-busy", busy);
}
async function guarded(root, label, action) {
    const current = runtime.get(root);
    if (current?.busy)
        return;
    const generation = current?.generation;
    setBusy(root, true, generation);
    status(root, `${label}…`, "info", generation);
    try {
        await action(generation);
        status(root, `${label} completed.`, "success", generation);
    }
    catch (error) {
        status(root, error instanceof Error ? error.message : String(error), "error", generation);
        Zotero.logError?.(error);
    }
    finally {
        setBusy(root, false, generation);
    }
}
function resultPanel(doc, root) {
    const panel = root.querySelector(".pprw-result");
    panel.replaceChildren();
    return panel;
}
function collectEvidence(value, result = [], seen = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object")
        return result;
    if (visited.has(value))
        return result;
    visited.add(value);
    if (Array.isArray(value)) {
        for (const entry of value)
            collectEvidence(entry, result, seen, visited);
        return result;
    }
    const record = value;
    if (typeof record.attachmentKey === "string" && (record.pageIndex !== undefined || record.sectionPath || record.quote || record.elementType)) {
        const key = `${record.attachmentKey}:${record.pageIndex}:${record.quote || ""}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(record);
        }
    }
    for (const entry of Object.values(record))
        collectEvidence(entry, result, seen, visited);
    return result;
}
function renderOutput(doc, root, title, value, attachmentID, generation) {
    if (!isCurrent(root, generation))
        return;
    const panel = resultPanel(doc, root);
    panel.append(element(doc, "h3", "pprw-result-title", title));
    const evidence = collectEvidence(value);
    if (evidence.length) {
        const links = element(doc, "div", "pprw-evidence-links");
        for (const reference of evidence.slice(0, 40)) {
            const label = (0, types_1.formatEvidenceLocator)(reference);
            links.append(button(doc, label, () => guarded(root, "Opening evidence", async () => {
                if (!attachmentID)
                    throw new Error("The source PDF is not available in this pane.");
                await (0, platform_1.openEvidence)({ fallbackAttachmentID: attachmentID, attachmentKey: reference.attachmentKey, pageIndex: reference.pageIndex });
            }), "pprw-evidence"));
        }
        panel.append(links);
    }
    const pre = element(doc, "pre", "pprw-pre");
    pre.textContent = safeStringify(value);
    panel.append(pre);
}
function paperSummary(doc, paper) {
    const node = element(doc, "div", "pprw-paper-summary");
    node.append(element(doc, "strong", "", paper.title));
    node.append(element(doc, "span", "", `${paper.extractionQuality} · ${paper.wordCount.toLocaleString()} words · attachment ${paper.attachmentKey}`));
    return node;
}
async function renderResearchWorkspaceView(root, item, service, loaders = {}) {
    const doc = root.ownerDocument;
    const previous = runtime.get(root);
    if (previous?.itemID === item?.id && !previous.loadFailed && root.childElementCount)
        return;
    const renderGeneration = Symbol("research-workspace-render");
    runtime.set(root, { itemID: item?.id, busy: false, generation: renderGeneration });
    root.className = "paperpilot-research-workspace";
    root.replaceChildren();
    const title = element(doc, "div", "pprw-title");
    title.append(element(doc, "h2", "", "PaperPilot Research Workspace"));
    title.append(element(doc, "p", "", "Evidence-grounded reading, mastery, reproducibility, cross-paper synthesis, and monitoring."));
    root.append(title);
    const statusNode = element(doc, "div", "pprw-status", "Loading paper…");
    statusNode.dataset.kind = "info";
    root.append(statusNode);
    const result = element(doc, "div", "pprw-result");
    root.append(result);
    let state;
    let paper;
    try {
        state = await service.state();
        if (!isCurrent(root, renderGeneration))
            return;
        paper = await (loaders.loadPaper ?? platform_1.loadPaperSource)(item, state.preferences.maxPaperCharacters);
        if (!isCurrent(root, renderGeneration))
            return;
        runtime.set(root, { itemID: item?.id, paper, busy: false, generation: renderGeneration });
        await service.registerPaper(paper);
        if (!isCurrent(root, renderGeneration))
            return;
        root.insertBefore(paperSummary(doc, paper), result);
        status(root, "Ready.", "success", renderGeneration);
    }
    catch (error) {
        if (isCurrent(root, renderGeneration)) {
            runtime.set(root, { itemID: item?.id, busy: false, generation: renderGeneration, loadFailed: true });
            status(root, error instanceof Error ? error.message : String(error), "error", renderGeneration);
        }
        return;
    }
    const configuration = details(doc, "Configuration", true);
    const provider = element(doc, "select", "pprw-select");
    for (const value of ["codex", "claude", "gemini"]) {
        const option = element(doc, "option");
        option.value = value;
        option.textContent = value;
        option.selected = state.preferences.provider === value;
        provider.append(option);
    }
    const executable = input(doc, "CLI executable", state.preferences.executables[state.preferences.provider]);
    const language = input(doc, "Response language", state.preferences.responseLanguage);
    const maxCharacters = input(doc, "Max paper characters", String(state.preferences.maxPaperCharacters));
    maxCharacters.type = "number";
    maxCharacters.min = "10000";
    maxCharacters.max = "10000000";
    maxCharacters.step = "10000";
    provider.addEventListener("change", () => { executable.value = state.preferences.executables[provider.value] || provider.value; });
    const configRow = row(doc);
    configRow.append(provider, executable, language, maxCharacters, button(doc, "Save", () => guarded(root, "Saving configuration", async () => { state = await service.configure({ provider: provider.value, executable: executable.value, responseLanguage: language.value, maxPaperCharacters: Number(maxCharacters.value) }); })));
    configuration.content.append(configRow);
    root.insertBefore(configuration.root, result);
    const search = details(doc, "Local hybrid search", true);
    const searchInput = input(doc, "Search concepts, symbols, sections, or exact identifiers");
    const searchRow = row(doc);
    searchRow.append(searchInput, button(doc, "Search", async () => {
        const results = service.searchPaper(paper, searchInput.value);
        renderOutput(doc, root, `Search · ${searchInput.value}`, results.map((entry) => ({ score: entry.score, section: entry.chunk.sectionPath, pageIndex: entry.chunk.pageIndex, text: entry.chunk.text.slice(0, 900), components: entry.components })), paper.attachmentID, renderGeneration);
    }));
    search.content.append(searchRow);
    root.insertBefore(search.root, result);
    const understanding = details(doc, "Understand and challenge", true);
    const actionRow = row(doc);
    actionRow.append(button(doc, "Extract claims", () => guarded(root, "Extracting claims", async () => renderOutput(doc, root, "Claim–Evidence Ledger", await service.extractClaims(paper), paper.attachmentID, renderGeneration))), button(doc, "Critical Read", () => guarded(root, "Running profiled Critical Read", async () => renderOutput(doc, root, "Profiled Critical Read", await service.runCriticalRead(paper), paper.attachmentID, renderGeneration))), button(doc, "Reproducibility", () => guarded(root, "Auditing reproducibility", async () => { const report = await service.runReproducibility(paper); renderOutput(doc, root, `Reproducibility · ${formatPercent((0, readiness_1.calculateReproducibilityReadiness)(report).score)}`, report, paper.attachmentID, renderGeneration); })), button(doc, "Paper-to-Code", () => guarded(root, "Building Paper-to-Code map", async () => renderOutput(doc, root, "Paper-to-Code", await service.runPaperToCode(paper), paper.attachmentID, renderGeneration))));
    understanding.content.append(actionRow);
    root.insertBefore(understanding.root, result);
    const mastery = details(doc, "Paper Mastery 2.0", true);
    const question = element(doc, "div", "pprw-question", "Start or resume to generate an evidence-grounded question.");
    const answer = textarea(doc, "Answer without looking at the paper when possible.", 6);
    const confidence = element(doc, "input", "pprw-range");
    confidence.type = "range";
    confidence.min = "0";
    confidence.max = "1";
    confidence.step = "0.05";
    confidence.value = "0.7";
    const confidenceLabel = element(doc, "span", "pprw-confidence", "Confidence: 70%");
    confidence.addEventListener("input", () => confidenceLabel.textContent = `Confidence: ${Math.round(Number(confidence.value) * 100)}%`);
    const masteryRow = row(doc);
    masteryRow.append(button(doc, "Start / Resume", () => guarded(root, "Preparing mastery", async () => { const value = await service.startOrResumeMastery(paper); question.textContent = value.question?.prompt || "Session complete. Review the dashboard."; renderOutput(doc, root, "Mastery dashboard", value.dashboard, paper.attachmentID, renderGeneration); })), button(doc, "Submit answer", () => guarded(root, "Grading answer", async () => { const value = await service.submitMastery(paper, answer.value, Number(confidence.value)); answer.value = ""; question.textContent = value.question?.prompt || "Session complete. Review the dashboard."; renderOutput(doc, root, "Mastery feedback", { feedback: value.feedback, dashboard: value.dashboard }, paper.attachmentID, renderGeneration); })));
    mastery.content.append(question, answer, confidenceLabel, confidence, masteryRow);
    root.insertBefore(mastery.root, result);
    const collection = details(doc, "Selected-paper intelligence", false);
    const selectedHint = element(doc, "p", "pprw-muted", "Select two or more Zotero items before running these tools.");
    const crossQuestion = element(doc, "div", "pprw-question", "No cross-paper question yet.");
    const crossAnswer = textarea(doc, "Cross-paper answer", 5);
    const collectionRow = row(doc);
    collectionRow.append(button(doc, "Evidence Matrix", () => guarded(root, "Building Evidence Matrix", async () => { const papers = await (loaders.loadSelectedPapers ?? platform_1.loadSelectedPaperSources)((await service.state()).preferences.maxPaperCharacters); const value = await service.createEvidenceMatrix(papers); renderOutput(doc, root, `Evidence Matrix · coverage ${formatPercent(value.coverage.extractionCoverage)}`, value, paper.attachmentID, renderGeneration); })), button(doc, "Literature Graph", () => guarded(root, "Building literature graph", async () => { const papers = await (loaders.loadSelectedPapers ?? platform_1.loadSelectedPaperSources)((await service.state()).preferences.maxPaperCharacters); const graph = await service.createLiteratureGraph(papers); renderOutput(doc, root, `Literature Graph · ${(0, graph_1.validateLiteratureGraph)(graph).valid ? "valid" : "needs review"}`, graph, paper.attachmentID, renderGeneration); })), button(doc, "Cross-paper question", () => guarded(root, "Creating cross-paper question", async () => { const papers = await (loaders.loadSelectedPapers ?? platform_1.loadSelectedPaperSources)((await service.state()).preferences.maxPaperCharacters); const value = await service.startCrossPaperMastery(papers); const current = runtime.get(root); if (!current || current.generation !== renderGeneration)
        return; current.crossSessionId = value.session.id; current.selectedPapers = papers; crossQuestion.textContent = value.question.prompt; renderOutput(doc, root, "Cross-paper mastery rubric hidden until grading", { mode: value.question.mode, difficulty: value.question.difficulty, paperKeys: value.question.paperKeys }, paper.attachmentID, renderGeneration); })), button(doc, "Grade cross-paper answer", () => guarded(root, "Grading cross-paper answer", async () => { const current = runtime.get(root); if (!current || current.generation !== renderGeneration)
        return; if (!current.crossSessionId || !current.selectedPapers)
        throw new Error("Create a cross-paper question first."); const value = await service.submitCrossPaperMastery(current.crossSessionId, current.selectedPapers, crossAnswer.value, 0.7); renderOutput(doc, root, "Cross-paper mastery feedback", value, paper.attachmentID, renderGeneration); })));
    collection.content.append(selectedHint, collectionRow, crossQuestion, crossAnswer);
    root.insertBefore(collection.root, result);
    const citations = details(doc, "Citation stance", false);
    const citationInput = textarea(doc, 'JSON array: [{"id":"c1","citingPaperKey":"A","citedPaperKey":"B","context":"...","evidence":[]}]', 7);
    citations.content.append(citationInput, button(doc, "Classify contexts", () => guarded(root, "Classifying citation contexts", async () => { const parsed = JSON.parse(citationInput.value); if (!Array.isArray(parsed))
        throw new Error("Citation input must be a JSON array."); renderOutput(doc, root, "Citation stance", await service.classifyCitationContexts(parsed), paper.attachmentID, renderGeneration); })));
    root.insertBefore(citations.root, result);
    const monitor = details(doc, "Research monitor", false);
    const monitorName = input(doc, "Monitor name", "Related work updates");
    const monitorQuery = input(doc, "Scholarly search query");
    const monitorSelect = element(doc, "select", "pprw-select");
    function fillMonitors(nextState) { monitorSelect.replaceChildren(); for (const value of nextState.monitors) {
        const option = element(doc, "option");
        option.value = value.id;
        option.textContent = `${value.name} · next ${value.nextRunAt.slice(0, 10)}`;
        monitorSelect.append(option);
    } }
    fillMonitors(state);
    const monitorRow = row(doc);
    monitorRow.append(monitorName, monitorQuery, button(doc, "Add", () => guarded(root, "Adding monitor", async () => { await service.addMonitor(monitorName.value, monitorQuery.value, 7); state = await service.state(); fillMonitors(state); })));
    const monitorRunRow = row(doc);
    monitorRunRow.append(monitorSelect, button(doc, "Run now", () => guarded(root, "Running research monitor", async () => { if (!monitorSelect.value)
        throw new Error("Add a monitor first."); renderOutput(doc, root, "Research monitor", await service.runMonitor(monitorSelect.value), paper.attachmentID, renderGeneration); })));
    monitor.content.append(monitorRow, monitorRunRow);
    root.insertBefore(monitor.root, result);
    const exportSection = details(doc, "Export", false);
    exportSection.content.append(button(doc, "Export workspace JSON + Markdown", () => guarded(root, "Exporting workspace", async () => renderOutput(doc, root, "Export complete", await service.exportWorkspace(), undefined, renderGeneration))));
    root.insertBefore(exportSection.root, result);
}
