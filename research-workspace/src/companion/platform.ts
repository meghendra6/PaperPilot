"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinPath = joinPath;
exports.profileDirectory = profileDirectory;
exports.workspaceDirectory = workspaceDirectory;
exports.createZoteroStorage = createZoteroStorage;
exports.createAgentPlatform = createAgentPlatform;
exports.resolvePdfAttachment = resolvePdfAttachment;
exports.loadPaperSource = loadPaperSource;
exports.selectedItems = selectedItems;
exports.loadSelectedPaperSources = loadSelectedPaperSources;
exports.makeRunPaths = makeRunPaths;
exports.openEvidence = openEvidence;
exports.exportTextFile = exportTextFile;
function sanitizeSegment(value) {
    return String(value || "item").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
function joinPath(...parts) {
    if (typeof PathUtils !== "undefined" && PathUtils.join)
        return PathUtils.join(...parts);
    return parts.join("/").replace(/\/+/g, "/");
}
function profileDirectory() {
    if (typeof PathUtils !== "undefined" && PathUtils.profileDir)
        return PathUtils.profileDir;
    if (typeof Zotero !== "undefined" && Zotero.Profile?.dir)
        return Zotero.Profile.dir;
    if (typeof Zotero !== "undefined" && Zotero.DataDirectory?.dir)
        return Zotero.DataDirectory.dir;
    throw new Error("Unable to resolve the Zotero profile directory.");
}
function workspaceDirectory() {
    return joinPath(profileDirectory(), "paperpilot-research-workspace");
}
function createZoteroStorage() {
    return {
        async exists(path) {
            return Boolean(await IOUtils.exists(path));
        },
        async readText(path) {
            return IOUtils.readUTF8(path);
        },
        async writeTextAtomic(path, content) {
            const parent = PathUtils.parent(path);
            await IOUtils.makeDirectory(parent, { createAncestors: true, ignoreExisting: true });
            const tmpPath = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            try {
                await IOUtils.writeUTF8(tmpPath, content);
                await IOUtils.move(tmpPath, path, { noOverwrite: false });
            }
            finally {
                try {
                    await IOUtils.remove(tmpPath, { ignoreAbsent: true });
                }
                catch { /* preserve the original write/move result */ }
            }
        },
    };
}
async function readSubprocessPipe(pipe) {
    if (!pipe?.readString)
        return "";
    let output = "";
    while (true) {
        const chunk = await pipe.readString();
        if (!chunk)
            break;
        output += chunk;
    }
    return output;
}
function commonExecutableCandidates(executable) {
    const home = String(globalThis.Services?.env?.get?.("HOME") || "").trim();
    const candidates = [
        `/opt/homebrew/bin/${executable}`,
        `/usr/local/bin/${executable}`,
        `/usr/bin/${executable}`,
        home ? `${home}/.local/bin/${executable}` : "",
        home ? `${home}/.npm-global/bin/${executable}` : "",
    ];
    return candidates.filter(Boolean);
}
async function resolveExecutable(executable, Subprocess) {
    const trimmed = String(executable || "").trim();
    if (!trimmed)
        throw new Error("Configure an AI CLI executable first.");
    if (/[\/]/.test(trimmed)) {
        if (!(await IOUtils.exists(trimmed)))
            throw new Error(`AI CLI executable was not found: ${trimmed}`);
        return trimmed;
    }
    try {
        const resolved = await Subprocess.pathSearch(trimmed);
        if (resolved)
            return String(resolved);
    }
    catch { /* continue with common user-install locations */ }
    for (const candidate of commonExecutableCandidates(trimmed)) {
        try {
            if (await IOUtils.exists(candidate))
                return candidate;
        }
        catch { /* try next */ }
    }
    throw new Error(`Unable to find the '${trimmed}' CLI. Enter its absolute path in Research Workspace settings ` +
        `(for example /opt/homebrew/bin/${trimmed} or /usr/local/bin/${trimmed}).`);
}
function subprocessExitCode(waitResult, process) {
    const raw = waitResult?.exitCode ?? waitResult?.code ?? process?.exitCode ?? waitResult;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : undefined;
}
function createAgentPlatform() {
    return {
        async execute(executable, args) {
            const imported = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
            const Subprocess = imported.Subprocess;
            const command = await resolveExecutable(executable, Subprocess);
            const process = await Subprocess.call({ command, arguments: args });
            const waitPromise = process.wait?.() ?? Promise.resolve(undefined);
            const [stdout, stderr, waitResult] = await Promise.all([
                readSubprocessPipe(process.stdout),
                readSubprocessPipe(process.stderr),
                waitPromise,
            ]);
            const exitCode = subprocessExitCode(waitResult, process);
            if (exitCode === undefined)
                throw new Error("The AI CLI process ended without a verifiable exit code.");
            return { stdout, stderr, exitCode };
        },
        async ensureDirectory(path) {
            await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
        },
        async writeText(path, content) {
            await IOUtils.writeUTF8(path, content);
        },
    };
}
function isPdfAttachment(item) {
    try {
        return Boolean(item?.isAttachment?.() && (item.attachmentContentType === "application/pdf" || String(item.getField?.("contentType") || "").includes("pdf")));
    }
    catch {
        return false;
    }
}
function resolvePdfAttachment(item) {
    if (!item)
        return null;
    if (isPdfAttachment(item))
        return item;
    const ids = item.getAttachments?.() || [];
    const attachments = ids.map((id) => Zotero.Items.get(id)).filter(Boolean);
    return attachments.find(isPdfAttachment) || null;
}
function metadataContext(item, title) {
    const abstract = String(item?.getField?.("abstractNote") || "").trim();
    const creators = (item?.getCreators?.() || []).map((creator) => [creator.firstName, creator.lastName].filter(Boolean).join(" ")).filter(Boolean).join(", ");
    const date = String(item?.getField?.("date") || "").trim();
    const publication = String(item?.getField?.("publicationTitle") || item?.getField?.("conferenceName") || "").trim();
    return [
        `# ${title}`,
        creators ? `Authors: ${creators}` : "",
        date ? `Date: ${date}` : "",
        publication ? `Publication: ${publication}` : "",
        abstract ? `\n## Abstract\n${abstract}` : "",
    ].filter(Boolean).join("\n");
}
async function loadPaperSource(item, maxCharacters) {
    const attachment = resolvePdfAttachment(item);
    if (!attachment)
        throw new Error("This item has no PDF attachment.");
    const parent = attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : item;
    const title = String(parent?.getField?.("title") || attachment.getField?.("title") || "Untitled paper").trim();
    const metadata = metadataContext(parent, title);
    let body = String(attachment.attachmentText || "").trim();
    let extractionQuality = body ? "zotero_text" : "unavailable";
    if (!body) {
        const fallback = String(parent?.getField?.("abstractNote") || "").trim();
        if (fallback) {
            body = fallback;
            extractionQuality = "plain_text";
        }
    }
    const numericLimit = Number(maxCharacters);
    const limit = Number.isFinite(numericLimit)
        ? Math.max(10000, Math.min(10000000, Math.floor(numericLimit)))
        : 1500000;
    const context = `${metadata}\n\n## Extracted paper text\n${body || "[Paper text unavailable. Run Zotero full-text indexing first.]"}`.slice(0, limit);
    return {
        paperKey: String(parent?.key || attachment.key || attachment.id),
        itemID: Number(parent?.id || attachment.id),
        attachmentID: Number(attachment.id),
        attachmentKey: String(attachment.key || attachment.id),
        title,
        context,
        extractionQuality,
        wordCount: context.split(/\s+/).filter(Boolean).length,
    };
}
function selectedItems() {
    try {
        return Zotero.getActiveZoteroPane()?.getSelectedItems?.() || [];
    }
    catch {
        return [];
    }
}
async function loadSelectedPaperSources(maxCharacters, maxPapers = 12) {
    const seen = new Set();
    const papers = [];
    for (const item of selectedItems().slice(0, Math.max(2, maxPapers))) {
        try {
            const paper = await loadPaperSource(item, maxCharacters);
            if (!seen.has(paper.paperKey)) {
                seen.add(paper.paperKey);
                papers.push(paper);
            }
        }
        catch { /* skip non-paper rows */ }
    }
    return papers;
}
function makeRunPaths(purpose) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const directory = joinPath(workspaceDirectory(), "runs", `${sanitizeSegment(purpose)}-${stamp}`);
    return { directory, promptPath: joinPath(directory, "prompt.txt") };
}
async function openEvidence(input) {
    let attachment = Zotero.Items.get(input.fallbackAttachmentID);
    const key = String(input.attachmentKey || "").trim();
    if (key && attachment?.key !== key) {
        const libraryIDs = [attachment?.libraryID, ...(Zotero.Libraries?.getAll?.() || []).map((library) => library.libraryID ?? library.id)]
            .filter((value, index, values) => Number.isFinite(Number(value)) && values.indexOf(value) === index);
        for (const libraryID of libraryIDs) {
            try {
                const candidate = Zotero.Items.getByLibraryAndKey?.(Number(libraryID), key);
                if (candidate) {
                    attachment = candidate;
                    break;
                }
            }
            catch { /* try the next accessible library */ }
        }
    }
    const attachmentID = Number(attachment?.id || input.fallbackAttachmentID);
    const options = Number.isFinite(input.pageIndex) ? { pageIndex: Math.max(0, Math.floor(input.pageIndex)) } : {};
    if (Zotero.Reader?.open) {
        await Zotero.Reader.open(attachmentID, options);
        return;
    }
    await Zotero.getActiveZoteroPane()?.viewAttachment?.(attachmentID);
}
async function exportTextFile(fileName, content) {
    const dir = joinPath(workspaceDirectory(), "exports");
    await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
    const path = joinPath(dir, sanitizeSegment(fileName));
    await IOUtils.writeUTF8(path, content);
    return path;
}
