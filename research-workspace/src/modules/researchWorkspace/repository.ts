"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearchWorkspaceRepository = void 0;
const state_1 = __require("src/modules/researchWorkspace/state.ts");
class ResearchWorkspaceRepository {
    constructor(pathOrStorage, storageOrPath) {
        if (typeof pathOrStorage === "string") {
            if (!storageOrPath || typeof storageOrPath === "string") {
                throw new Error("ResearchWorkspaceStorage is required.");
            }
            this.path = pathOrStorage;
            this.storage = storageOrPath;
        }
        else {
            this.storage = pathOrStorage;
            this.path = typeof storageOrPath === "string"
                ? storageOrPath
                : "paperpilot-research-workspace-v3.json";
        }
        this.writeQueue = Promise.resolve();
    }
    async readPersisted() {
        if (this.storage.exists && !(await this.storage.exists(this.path)))
            return undefined;
        const read = this.storage.read ?? this.storage.readText;
        if (!read)
            throw new Error("ResearchWorkspaceStorage requires read or readText.");
        return read.call(this.storage, this.path);
    }
    async load() {
        if (this.loaded)
            return structuredClone(this.loaded);
        const text = await this.readPersisted();
        if (text === undefined || text === null) {
            this.loaded = (0, state_1.createResearchWorkspaceState)();
            return structuredClone(this.loaded);
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            throw new Error(`Research Workspace contains invalid JSON at ${this.path}: ${String(error)}`);
        }
        this.loaded = (0, state_1.migrateResearchWorkspaceState)(parsed);
        return structuredClone(this.loaded);
    }
    async saveUnlocked(state) {
        const now = new Date().toISOString();
        const currentRevision = this.loaded?.revision ?? 0;
        const next = (0, state_1.migrateResearchWorkspaceState)({
            ...state,
            revision: Math.max(currentRevision, state.revision) + 1,
            updatedAt: now,
        }, now);
        const write = this.storage.writeAtomic ?? this.storage.writeTextAtomic;
        if (!write)
            throw new Error("ResearchWorkspaceStorage requires writeAtomic or writeTextAtomic.");
        await write.call(this.storage, this.path, `${JSON.stringify(next, null, 2)}\n`);
        this.loaded = next;
        return structuredClone(next);
    }
    enqueueWrite(operation) {
        const result = this.writeQueue.then(operation, operation);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }
    async save(state) {
        return this.enqueueWrite(() => this.saveUnlocked(state));
    }
    async update(mutator) {
        return this.enqueueWrite(async () => {
            const state = await this.load();
            const result = await mutator(state);
            return this.saveUnlocked(result ?? state);
        });
    }
    clearCache() { this.loaded = undefined; }
}
exports.ResearchWorkspaceRepository = ResearchWorkspaceRepository;
