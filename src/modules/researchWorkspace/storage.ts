import { getZoteroProfilePath } from "../../utils/zoteroProfile";
import { ResearchWorkspaceRepository } from "./core/researchWorkspace/repository";

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
  const profilePath = getZoteroProfilePath();
  if (!profilePath) {
    throw new Error("Could not resolve the Zotero profile directory.");
  }
  return joinPath(profilePath, STORAGE_DIRECTORY, STORAGE_FILE);
}

export function createResearchWorkspaceStorage() {
  return {
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
      if (ioUtils?.writeUTF8 && ioUtils?.move) {
        const temporaryPath = `${path}.tmp-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
        try {
          await ioUtils.writeUTF8(temporaryPath, contents);
          await ioUtils.move(temporaryPath, path, { noOverwrite: false });
        } finally {
          try {
            await ioUtils.remove?.(temporaryPath, { ignoreAbsent: true });
          } catch {
            // Preserve the original write/move result.
          }
        }
        return;
      }
      await zotero.File.putContentsAsync(path, contents, "utf-8");
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

let repository: InstanceType<typeof ResearchWorkspaceRepository> | undefined;

export function getResearchWorkspaceRepository() {
  if (!repository) {
    repository = new ResearchWorkspaceRepository(
      getResearchWorkspaceStoragePath(),
      createResearchWorkspaceStorage(),
    );
  }
  return repository;
}

export function resetResearchWorkspaceRepositoryForTests() {
  repository = undefined;
}
