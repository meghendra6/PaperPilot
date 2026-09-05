import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistoryFileOps,
  type SessionHistoryIndex,
  type SessionHistoryListEntry,
  type SessionHistoryRepositoryOptions,
  type SessionHistorySnapshot,
} from "./historyTypes";
import { getZoteroProfilePath } from "../../utils/zoteroProfile";

function getGlobalZotero() {
  return (globalThis as typeof globalThis & { Zotero?: typeof Zotero }).Zotero;
}

function getGlobalIOUtils() {
  return (globalThis as typeof globalThis & { IOUtils?: typeof IOUtils })
    .IOUtils;
}

function getGlobalPathUtils() {
  return (globalThis as typeof globalThis & { PathUtils?: typeof PathUtils })
    .PathUtils;
}

function joinPath(...parts: string[]) {
  const pathUtils = getGlobalPathUtils();
  if (pathUtils?.join) {
    return pathUtils.join(...parts);
  }

  const separator = parts.some((part) => part.includes("\\")) ? "\\" : "/";
  const normalizedParts = parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/[\\/]+$/g, "");
      }

      return part.replace(/^[\\/]+|[\\/]+$/g, "");
    })
    .filter((part) => part.length > 0);

  return normalizedParts.join(separator);
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEngineMode(value: unknown) {
  return (
    value === "codex_cli" || value === "claude_code" || value === "gemini_cli"
  );
}

function isSessionListEntry(value: unknown): value is SessionHistoryListEntry {
  if (!isPlainObject(value)) return false;
  return (
    value.storageVersion === SESSION_HISTORY_STORAGE_VERSION &&
    typeof value.sessionId === "string" &&
    Boolean(value.sessionId) &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Number.isInteger(value.messageCount) &&
    Number(value.messageCount) >= 0 &&
    (value.lastMode === undefined || isEngineMode(value.lastMode)) &&
    typeof value.hasArtifacts === "boolean" &&
    typeof value.hasRecommendations === "boolean" &&
    typeof value.hasMasteryState === "boolean"
  );
}

function isSessionHistoryIndex(
  value: unknown,
  itemID: number,
): value is SessionHistoryIndex {
  if (!isPlainObject(value)) return false;
  return (
    value.storageVersion === SESSION_HISTORY_STORAGE_VERSION &&
    value.paperItemID === itemID &&
    typeof value.paperTitle === "string" &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isSessionListEntry)
  );
}

function isSessionHistorySnapshot(
  value: unknown,
  itemID: number,
  sessionId: string,
): value is SessionHistorySnapshot {
  if (!isPlainObject(value)) return false;
  return (
    value.storageVersion === SESSION_HISTORY_STORAGE_VERSION &&
    value.sessionId === sessionId &&
    value.paperItemID === itemID &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.lastMode === undefined || isEngineMode(value.lastMode)) &&
    (value.messages === undefined || Array.isArray(value.messages))
  );
}

function defaultWarn(message: string) {
  const zotero = getGlobalZotero();
  if (zotero?.logError) {
    zotero.logError(new Error(message));
    return;
  }
  globalThis.console?.warn?.(`[Paper Pilot] ${message}`);
}

function hasMeaningfulState(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (!isPlainObject(value)) {
    return Boolean(value);
  }

  return Object.keys(value).length > 0;
}

function compareDescending(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
}

function sortSessionEntries(entries: SessionHistoryListEntry[]) {
  return [...entries].sort((left, right) => {
    const updatedAtOrder = compareDescending(left.updatedAt, right.updatedAt);
    if (updatedAtOrder !== 0) {
      return updatedAtOrder;
    }

    const createdAtOrder = compareDescending(left.createdAt, right.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }

    return left.sessionId.localeCompare(right.sessionId);
  });
}

function emptyIndex(itemID: number, paperTitle = ""): SessionHistoryIndex {
  return {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    paperItemID: itemID,
    paperTitle,
    sessions: [],
  };
}

function toSessionEntry(
  snapshot: SessionHistorySnapshot,
): SessionHistoryListEntry {
  return {
    storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    messageCount: snapshot.messages?.length ?? 0,
    lastMode: snapshot.lastMode,
    hasArtifacts: hasMeaningfulState(snapshot.paperArtifacts),
    hasRecommendations: hasMeaningfulState(snapshot.relatedRecommendations),
    hasMasteryState: hasMeaningfulState(snapshot.mastery),
    ...(hasMeaningfulState(snapshot.criticalRead)
      ? { hasCriticalReadState: true }
      : {}),
  };
}

function sessionIdFromPath(filePath: string) {
  return getFileName(filePath).replace(/\.json$/i, "");
}

function createDefaultFileOps(): SessionHistoryFileOps {
  return {
    async ensureDirectory(path: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.createDirectoryIfMissingAsync) {
        throw new Error(
          "Zotero file APIs are unavailable for session history persistence.",
        );
      }

      await zotero.File.createDirectoryIfMissingAsync(path);
    },
    async readText(path: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.getContentsAsync) {
        throw new Error(
          "Zotero file APIs are unavailable for session history persistence.",
        );
      }

      return String(
        (await Promise.resolve(zotero.File.getContentsAsync(path, "utf-8"))) ??
          "",
      );
    },
    async writeTextAtomic(path: string, contents: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.putContentsAsync) {
        throw new Error(
          "Zotero file APIs are unavailable for session history persistence.",
        );
      }

      await zotero.File.putContentsAsync(path, contents, "utf-8");
    },
    async remove(path: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.removeIfExists) {
        throw new Error(
          "Zotero file APIs are unavailable for session history persistence.",
        );
      }

      await zotero.File.removeIfExists(path);
    },
    async exists(path: string) {
      const ioUtils = getGlobalIOUtils();
      if (ioUtils?.exists) {
        try {
          return await ioUtils.exists(path);
        } catch {
          return false;
        }
      }

      const zotero = getGlobalZotero();
      if (zotero?.File?.getContentsAsync) {
        try {
          await Promise.resolve(zotero.File.getContentsAsync(path, "utf-8"));
          return true;
        } catch {
          return false;
        }
      }

      return false;
    },
    async listDirectory(path: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.iterateDirectory) {
        throw new Error(
          "Zotero file APIs are unavailable for session history persistence.",
        );
      }

      const entries: string[] = [];
      try {
        await zotero.File.iterateDirectory(
          path,
          async (entry: { isDir?: boolean; path: string }) => {
            if (!entry.isDir) {
              entries.push(entry.path);
            }
          },
        );
      } catch {
        return [];
      }

      return entries;
    },
  };
}

export function resolveDefaultSessionHistoryRootDir() {
  const profilePath = getZoteroProfilePath(getGlobalZotero());
  if (profilePath) {
    return joinPath(profilePath, "paperpilot", "session-history");
  }

  throw new Error(
    "Could not resolve the Zotero profile directory for session history.",
  );
}

export class SessionHistoryRepository {
  private readonly rootDir?: string;
  private readonly fileOps: SessionHistoryFileOps;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;
  private readonly indexCache = new Map<number, SessionHistoryIndex>();

  constructor(options: SessionHistoryRepositoryOptions = {}) {
    this.rootDir = options.rootDir;
    this.fileOps = options.fileOps || createDefaultFileOps();
    this.now = options.now || (() => new Date());
    this.warn = options.warn || defaultWarn;
  }

  getPaperRoot(itemID: number) {
    return joinPath(
      this.rootDir || resolveDefaultSessionHistoryRootDir(),
      "papers",
      String(itemID),
    );
  }

  getPaperIndexPath(itemID: number) {
    return joinPath(this.getPaperRoot(itemID), "index.json");
  }

  getSessionsRoot(itemID: number) {
    return joinPath(this.getPaperRoot(itemID), "sessions");
  }

  getSessionSnapshotPath(itemID: number, sessionId: string) {
    return joinPath(this.getSessionsRoot(itemID), `${sessionId}.json`);
  }

  private async quarantineCorruptFile(path: string, raw: string) {
    const timestamp = this.now()
      .toISOString()
      .replace(/[^0-9TZ]/g, "-");
    const quarantinePath = `${path}.corrupt-${timestamp}`;
    try {
      await this.fileOps.writeTextAtomic(quarantinePath, raw);
      await this.fileOps.remove(path);
      this.warn(`Quarantined unreadable session history file: ${path}`);
    } catch (error) {
      this.warn(
        `Could not quarantine unreadable session history file ${path}: ${String(error)}`,
      );
    }
  }

  private async readJson(path: string): Promise<unknown> {
    let raw: string | undefined;
    try {
      raw = await this.fileOps.readText(path);
    } catch {
      return undefined;
    }

    if (raw === undefined || !String(raw).trim()) {
      return undefined;
    }

    try {
      return JSON.parse(raw);
    } catch {
      await this.quarantineCorruptFile(path, raw);
      return undefined;
    }
  }

  private rejectsFutureVersion(value: unknown, path: string) {
    if (
      isPlainObject(value) &&
      typeof value.storageVersion === "number" &&
      value.storageVersion > SESSION_HISTORY_STORAGE_VERSION
    ) {
      this.warn(
        `Refusing future session history version ${value.storageVersion} at ${path}.`,
      );
      return true;
    }
    return false;
  }

  private async ensurePaperDirectories(itemID: number) {
    await this.fileOps.ensureDirectory(this.getPaperRoot(itemID));
    await this.fileOps.ensureDirectory(this.getSessionsRoot(itemID));
  }

  private async recoverSessionsFromDisk(
    itemID: number,
    indexedSessionIDs: readonly string[] = [],
  ) {
    const sessionsRoot = this.getSessionsRoot(itemID);
    let filePaths: string[] = [];

    try {
      filePaths = await this.fileOps.listDirectory(sessionsRoot);
    } catch {
      filePaths = [];
    }

    const recoveredEntries: SessionHistoryListEntry[] = [];
    const candidatePaths = new Set([
      ...filePaths,
      ...indexedSessionIDs.map((sessionID) =>
        this.getSessionSnapshotPath(itemID, sessionID),
      ),
    ]);
    for (const filePath of candidatePaths) {
      if (!filePath.endsWith(".json")) {
        continue;
      }

      const snapshot = await this.readSessionSnapshot(
        itemID,
        sessionIdFromPath(filePath),
      );
      if (snapshot) {
        recoveredEntries.push(toSessionEntry(snapshot));
      }
    }

    return recoveredEntries;
  }

  private mergeRecoveredSessions(
    indexSessions: SessionHistoryListEntry[],
    recoveredSessions: SessionHistoryListEntry[],
  ) {
    const merged = new Map<string, SessionHistoryListEntry>();

    for (const entry of indexSessions) {
      merged.set(entry.sessionId, entry);
    }

    for (const entry of recoveredSessions) {
      merged.set(entry.sessionId, entry);
    }

    return sortSessionEntries([...merged.values()]);
  }

  private normalizeIndex(index: SessionHistoryIndex): SessionHistoryIndex {
    return {
      storageVersion: SESSION_HISTORY_STORAGE_VERSION,
      paperItemID: index.paperItemID,
      paperTitle: index.paperTitle,
      sessions: sortSessionEntries(index.sessions).map((entry) => ({
        ...entry,
        storageVersion: SESSION_HISTORY_STORAGE_VERSION,
        ...(entry.hasCriticalReadState ? { hasCriticalReadState: true } : {}),
      })),
    };
  }

  async readPaperIndex(itemID: number): Promise<SessionHistoryIndex> {
    const cached = this.indexCache.get(itemID);
    if (cached) return this.normalizeIndex(cached);
    const indexPath = this.getPaperIndexPath(itemID);
    const candidate = await this.readJson(indexPath);
    const index = isSessionHistoryIndex(candidate, itemID)
      ? candidate
      : undefined;
    if (candidate !== undefined && !index) {
      if (!this.rejectsFutureVersion(candidate, indexPath)) {
        this.warn(`Ignoring invalid session history index at ${indexPath}.`);
      }
    }
    const recoveredSessions = await this.recoverSessionsFromDisk(
      itemID,
      index?.sessions.map((entry) => entry.sessionId),
    );
    const normalized = !index
      ? {
          ...emptyIndex(itemID),
          sessions: sortSessionEntries(recoveredSessions),
        }
      : this.normalizeIndex({
          ...index,
          sessions: this.mergeRecoveredSessions([], recoveredSessions),
        });
    this.indexCache.set(itemID, normalized);
    return this.normalizeIndex(normalized);
  }

  async writePaperIndex(index: SessionHistoryIndex) {
    const normalized = this.normalizeIndex(index);
    await this.ensurePaperDirectories(normalized.paperItemID);
    await this.fileOps.writeTextAtomic(
      this.getPaperIndexPath(normalized.paperItemID),
      JSON.stringify(normalized, null, 2),
    );
    this.indexCache.set(normalized.paperItemID, normalized);
  }

  async readSessionSnapshot(
    itemID: number,
    sessionId: string,
  ): Promise<SessionHistorySnapshot | undefined> {
    const snapshotPath = this.getSessionSnapshotPath(itemID, sessionId);
    const candidate = await this.readJson(snapshotPath);
    if (!isSessionHistorySnapshot(candidate, itemID, sessionId)) {
      if (candidate !== undefined) {
        if (!this.rejectsFutureVersion(candidate, snapshotPath)) {
          this.warn(
            `Ignoring invalid session history snapshot at ${snapshotPath}.`,
          );
        }
      }
      return undefined;
    }

    return candidate;
  }

  async saveSessionSnapshot(params: {
    paperItemID: number;
    paperTitle: string;
    snapshot: SessionHistorySnapshot;
  }) {
    const snapshot = {
      ...params.snapshot,
      storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    };
    const index = await this.readPaperIndex(params.paperItemID);
    const paperTitle = params.paperTitle.trim() || index.paperTitle;
    const updatedEntries = new Map(
      index.sessions.map((entry) => [entry.sessionId, entry]),
    );
    updatedEntries.set(snapshot.sessionId, toSessionEntry(snapshot));

    await this.ensurePaperDirectories(params.paperItemID);
    await this.fileOps.writeTextAtomic(
      this.getSessionSnapshotPath(params.paperItemID, snapshot.sessionId),
      JSON.stringify(snapshot, null, 2),
    );

    await this.writePaperIndex({
      storageVersion: SESSION_HISTORY_STORAGE_VERSION,
      paperItemID: params.paperItemID,
      paperTitle,
      sessions: sortSessionEntries([...updatedEntries.values()]),
    });
  }

  async deleteSession(itemID: number, sessionId: string) {
    const index = await this.readPaperIndex(itemID);
    const remainingSessions = index.sessions.filter(
      (entry) => entry.sessionId !== sessionId,
    );

    await this.fileOps.remove(this.getSessionSnapshotPath(itemID, sessionId));
    if (!remainingSessions.length) {
      await this.fileOps.remove(this.getPaperIndexPath(itemID));
      this.indexCache.delete(itemID);
      return;
    }

    await this.writePaperIndex({
      ...index,
      sessions: remainingSessions,
    });
  }

  async deleteAllSessions(itemID: number) {
    const index = await this.readPaperIndex(itemID);
    await Promise.all(
      index.sessions.map((entry) =>
        this.fileOps.remove(
          this.getSessionSnapshotPath(itemID, entry.sessionId),
        ),
      ),
    );
    await this.fileOps.remove(this.getPaperIndexPath(itemID));
    this.indexCache.delete(itemID);
  }

  async listSessions(itemID: number) {
    return (await this.readPaperIndex(itemID)).sessions;
  }
}

export const sessionHistoryRepository = new SessionHistoryRepository();
