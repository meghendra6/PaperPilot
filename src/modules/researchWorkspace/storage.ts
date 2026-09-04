import { getZoteroProfilePath } from "../../utils/zoteroProfile";
import { ResearchWorkspaceProjectRepository } from "./persistence/projectRepository";
import { LegacyResearchWorkspaceImporter } from "./persistence/legacyMigration";
import { ResearchWorkspaceLivingReviewService } from "./livingReviewService";
import { ResearchWorkspaceZoteroSyncService } from "./zoteroSyncService";

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

const STORAGE_DIRECTORY = "paperpilot-research-workspace";
const STORAGE_FILE = "workspace-v3.json";

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
  if (pathUtils?.join) return pathUtils.join(...parts);
  return parts
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/g, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
}

export function getResearchWorkspaceStoragePath() {
  return joinPath(getResearchWorkspaceStorageRoot(), STORAGE_FILE);
}

export function getResearchWorkspaceStorageRoot() {
  const profilePath = getZoteroProfilePath();
  if (!profilePath) {
    throw new Error("Could not resolve the Zotero profile directory.");
  }
  return joinPath(profilePath, STORAGE_DIRECTORY);
}

export function createResearchWorkspaceStorage() {
  return {
    async ensureDirectory(path: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.createDirectoryIfMissingAsync) {
        throw new Error(
          "Zotero file APIs are unavailable for Research Workspace storage.",
        );
      }
      await zotero.File.createDirectoryIfMissingAsync(path);
    },
    async exists(path: string) {
      const ioUtils = getGlobalIOUtils();
      if (ioUtils?.exists) return Boolean(await ioUtils.exists(path));
      try {
        await getGlobalZotero()?.File?.getContentsAsync?.(path, "utf-8");
        return true;
      } catch {
        return false;
      }
    },
    async readText(path: string) {
      const zotero = getGlobalZotero();
      if (!zotero?.File?.getContentsAsync) {
        throw new Error(
          "Zotero file APIs are unavailable for Research Workspace storage.",
        );
      }
      return String(
        (await Promise.resolve(zotero.File.getContentsAsync(path, "utf-8"))) ??
          "",
      );
    },
    async writeTextAtomic(path: string, contents: string) {
      const zotero = getGlobalZotero();
      if (
        !zotero?.File?.createDirectoryIfMissingAsync ||
        !zotero?.File?.putContentsAsync
      ) {
        throw new Error(
          "Zotero file APIs are unavailable for Research Workspace storage.",
        );
      }
      const pathUtils = getGlobalPathUtils();
      const parent = pathUtils?.parent
        ? pathUtils.parent(path)
        : path.replace(/[\\/][^\\/]+$/, "");
      await zotero.File.createDirectoryIfMissingAsync(parent);
      const ioUtils = getGlobalIOUtils();
      if (ioUtils?.writeUTF8) {
        const temporaryPath = `${path}.tmp-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
        try {
          await ioUtils.writeUTF8(path, contents, {
            tmpPath: temporaryPath,
            flush: true,
          });
        } finally {
          try {
            await ioUtils.remove?.(temporaryPath, { ignoreAbsent: true });
          } catch {
            // Preserve the original write/move result.
          }
        }
        return;
      }
      throw new Error(
        "Atomic Research Workspace writes require IOUtils.writeUTF8.",
      );
    },
    async remove(path: string, options?: { recursive?: boolean }) {
      const ioUtils = getGlobalIOUtils();
      if (ioUtils?.remove) {
        await ioUtils.remove(path, {
          recursive: Boolean(options?.recursive),
          ignoreAbsent: true,
        });
        return;
      }
      const zotero = getGlobalZotero();
      if (!zotero?.File?.removeIfExists) {
        throw new Error(
          "Zotero file APIs are unavailable for Research Workspace storage.",
        );
      }
      await zotero.File.removeIfExists(path);
    },
    async listDirectory(path: string) {
      const entries: string[] = [];
      const ioUtils = getGlobalIOUtils();
      if (ioUtils?.getChildren) {
        const walk = async (directory: string): Promise<void> => {
          let children: string[];
          try {
            children = await ioUtils.getChildren(directory);
          } catch {
            return;
          }
          for (const child of children) {
            entries.push(child);
            try {
              const info = await ioUtils.stat?.(child);
              if (info?.type === "directory") await walk(child);
            } catch {
              // Keep the readable path and continue the repair scan.
            }
          }
        };
        await walk(path);
        return entries;
      }
      const zotero = getGlobalZotero();
      if (!zotero?.File?.iterateDirectory) {
        throw new Error(
          "Zotero file APIs are unavailable for Research Workspace storage.",
        );
      }
      const walk = async (directory: string): Promise<void> => {
        try {
          await zotero.File.iterateDirectory(
            directory,
            async (entry: { isDir?: boolean; path: string }) => {
              entries.push(entry.path);
              if (entry.isDir) await walk(entry.path);
            },
          );
        } catch {
          // A missing directory is an empty repository, not an error.
        }
      };
      await walk(path);
      return entries;
    },
  };
}

export async function exportResearchWorkspaceTextFile(
  fileName: string,
  contents: string,
) {
  const profilePath = getZoteroProfilePath();
  if (!profilePath) {
    throw new Error("Could not resolve the Zotero profile directory.");
  }
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const directory = joinPath(profilePath, STORAGE_DIRECTORY, "exports");
  const path = joinPath(directory, safeName);
  const zotero = getGlobalZotero();
  if (
    !zotero?.File?.createDirectoryIfMissingAsync ||
    !zotero?.File?.putContentsAsync
  ) {
    throw new Error(
      "Zotero file APIs are unavailable for Research Workspace export.",
    );
  }
  await zotero.File.createDirectoryIfMissingAsync(directory);
  await zotero.File.putContentsAsync(path, contents, "utf-8");
  return path;
}

let projectRepository: ResearchWorkspaceProjectRepository | undefined;
let legacyImporter: LegacyResearchWorkspaceImporter | undefined;
let livingReviewService: ResearchWorkspaceLivingReviewService | undefined;
let zoteroSyncService: ResearchWorkspaceZoteroSyncService | undefined;

export function getResearchWorkspaceProjectRepository() {
  if (!projectRepository) {
    projectRepository = new ResearchWorkspaceProjectRepository({
      rootDir: getResearchWorkspaceStorageRoot(),
      fileOps: createResearchWorkspaceStorage(),
      warn: (message) => getGlobalZotero()?.debug?.(`[Paper Pilot] ${message}`),
    });
  }
  return projectRepository;
}

export function getResearchWorkspaceLivingReviewService() {
  if (!livingReviewService) {
    livingReviewService = new ResearchWorkspaceLivingReviewService(
      getResearchWorkspaceProjectRepository(),
    );
  }
  return livingReviewService;
}

export function getResearchWorkspaceZoteroSyncService() {
  if (!zoteroSyncService) {
    zoteroSyncService = new ResearchWorkspaceZoteroSyncService(
      getResearchWorkspaceProjectRepository(),
    );
  }
  return zoteroSyncService;
}

export async function recoverResearchWorkspaceProjectPersistence() {
  return getResearchWorkspaceProjectRepository().recoverStartup();
}

export function getLegacyResearchWorkspaceImporter() {
  if (!legacyImporter) {
    legacyImporter = new LegacyResearchWorkspaceImporter({
      rootDir: getResearchWorkspaceStorageRoot(),
      legacyPath: getResearchWorkspaceStoragePath(),
      fileOps: createResearchWorkspaceStorage(),
      repository: getResearchWorkspaceProjectRepository(),
    });
  }
  return legacyImporter;
}

export function migrateLegacyResearchWorkspace() {
  return getLegacyResearchWorkspaceImporter().migrate();
}

export function resetResearchWorkspaceRepositoryForTests() {
  projectRepository = undefined;
  legacyImporter = undefined;
  livingReviewService = undefined;
  zoteroSyncService = undefined;
}
