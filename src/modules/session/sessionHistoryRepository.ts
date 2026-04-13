import * as path from "node:path";

import {
  SESSION_HISTORY_STORAGE_VERSION,
  type SessionHistoryFileOps,
  type SessionHistoryIndex,
  type SessionHistoryListEntry,
  type SessionHistoryRepositoryOptions,
  type SessionHistorySnapshot,
} from "./historyTypes";

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

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

  return path.join(...parts);
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function toSessionEntry(snapshot: SessionHistorySnapshot): SessionHistoryListEntry {
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

function resolveDefaultRootDir() {
  const zotero = getGlobalZotero();
  const profilePath = zotero?.getProfileDirectory?.()?.path || "";
  if (profilePath) {
    return joinPath(profilePath, "paperpilot", "session-history");
  }

  return "/tmp/paperpilot/session-history";
}

export class SessionHistoryRepository {
  private readonly rootDir: string;
  private readonly fileOps: SessionHistoryFileOps;
  private readonly now: () => Date;

  constructor(options: SessionHistoryRepositoryOptions = {}) {
    this.rootDir = options.rootDir || resolveDefaultRootDir();
    this.fileOps = options.fileOps || createDefaultFileOps();
    this.now = options.now || (() => new Date());
  }

  getPaperRoot(itemID: number) {
    return joinPath(this.rootDir, "papers", String(itemID));
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

  private async readJson<T>(path: string): Promise<T | undefined> {
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
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private async ensurePaperDirectories(itemID: number) {
    await this.fileOps.ensureDirectory(this.getPaperRoot(itemID));
    await this.fileOps.ensureDirectory(this.getSessionsRoot(itemID));
  }

  private async recoverSessionsFromDisk(itemID: number) {
    const sessionsRoot = this.getSessionsRoot(itemID);
    let filePaths: string[] = [];

    try {
      filePaths = await this.fileOps.listDirectory(sessionsRoot);
    } catch {
      return [];
    }

    const recoveredEntries: SessionHistoryListEntry[] = [];
    for (const filePath of filePaths) {
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

  private async loadReadableIndexSessions(
    itemID: number,
    indexSessions: SessionHistoryListEntry[],
  ) {
    const readableEntries: SessionHistoryListEntry[] = [];

    for (const entry of indexSessions) {
      const snapshot = await this.readSessionSnapshot(itemID, entry.sessionId);
      if (snapshot) {
        readableEntries.push(toSessionEntry(snapshot));
      }
    }

    return readableEntries;
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
      })),
    };
  }

  async readPaperIndex(itemID: number): Promise<SessionHistoryIndex> {
    const index = await this.readJson<SessionHistoryIndex>(
      this.getPaperIndexPath(itemID),
    );
    const recoveredSessions = await this.recoverSessionsFromDisk(itemID);
    if (!index) {
      return {
        ...emptyIndex(itemID),
        sessions: sortSessionEntries(recoveredSessions),
      };
    }

    const readableIndexSessions = await this.loadReadableIndexSessions(
      itemID,
      index.sessions,
    );

    return this.normalizeIndex({
      ...index,
      sessions: this.mergeRecoveredSessions(
        readableIndexSessions,
        recoveredSessions,
      ),
    });
  }

  async writePaperIndex(index: SessionHistoryIndex) {
    const normalized = this.normalizeIndex(index);
    await this.ensurePaperDirectories(normalized.paperItemID);
    await this.fileOps.writeTextAtomic(
      this.getPaperIndexPath(normalized.paperItemID),
      JSON.stringify(normalized, null, 2),
    );
  }

  async readSessionSnapshot(
    itemID: number,
    sessionId: string,
  ): Promise<SessionHistorySnapshot | undefined> {
    const snapshot = await this.readJson<SessionHistorySnapshot>(
      this.getSessionSnapshotPath(itemID, sessionId),
    );
    if (!snapshot) {
      return undefined;
    }

    return {
      ...snapshot,
      storageVersion: SESSION_HISTORY_STORAGE_VERSION,
    };
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
  }

  async listSessions(itemID: number) {
    return (await this.readPaperIndex(itemID)).sessions;
  }
}

export const sessionHistoryRepository = new SessionHistoryRepository();
