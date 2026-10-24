import type { EngineMode } from "../../ai/types";
import { shellEscape } from "../../codex/shell";
import { stopDetachedRunProcess } from "../../ai/runCompletion";
import {
  parseExitStatusMarker,
  withExitStatusMarker,
} from "../../ai/subprocessStatus";
import {
  createResearchWorkspaceStorage,
  getResearchWorkspaceStorageRoot,
} from "../storage";
import { assertResearchWorkspaceID } from "./contracts";
import { researchProjectDirectory } from "./paths";

type EntryKind = "missing" | "file" | "directory" | "symlink";

export interface ProjectWorkspaceCleanupPorts {
  rootDir: string;
  inspect(path: string): Promise<EntryKind>;
  canonicalDirectory(path: string): Promise<string>;
  children(path: string): Promise<string[]>;
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string | undefined>;
  writeTextAtomic(path: string, contents: string): Promise<void>;
  /** Nonrecursive only, including directories after their children are gone. */
  remove(path: string): Promise<void>;
  confirmProcessStopped?(
    workspacePath: string,
    mode: EngineMode,
  ): Promise<void>;
}

export interface ProjectWorkspaceProcessPorts {
  read(path: string): Promise<string | undefined>;
  command(pid: string): Promise<string | undefined>;
  stop(pid: string): Promise<void>;
}

/** A saved PID alone never authorizes signaling a possibly recycled process. */
export async function confirmProjectWorkspaceProcessStopped(
  workspacePath: string,
  mode: EngineMode,
  ports: ProjectWorkspaceProcessPorts,
) {
  const path = allocatedPath(workspacePath).path;
  const prefix = mode === "codex_cli" ? "codex" : "claude";
  const exit = (await ports.read(`${path}/${prefix}-exit.txt`))?.trim();
  if (exit && /^\d{1,3}$/.test(exit) && Number(exit) <= 255) return;
  const pid = (await ports.read(`${path}/${prefix}-pid.txt`))?.trim();
  if (
    !pid ||
    !/^[1-9]\d*$/.test(pid) ||
    !Number.isSafeInteger(Number(pid)) ||
    Number(pid) <= 1
  )
    throw new Error(
      `CLI stop is not confirmed for ${path}. Stop the run and retry project deletion; its files were preserved.`,
    );
  const command = await ports.command(pid);
  if (command === undefined) return;
  const prefixPath = `${path}/`;
  if (
    !command.includes(prefixPath) &&
    !command.includes(shellEscape(prefixPath).slice(1, -1))
  )
    throw new Error(
      `The saved PID no longer identifies ${path}; no process was stopped.`,
    );
  await ports.stop(pid);
}

interface Allocation {
  workspacePath: string;
  canonicalRoot: string;
  mode: EngineMode;
  launchAttempted: boolean;
  cleanupConfirmed: boolean;
}

interface AllocationLedger {
  schemaVersion: 1;
  projectID: string;
  allocations: Allocation[];
}

const queues = new Map<string, Promise<void>>();
const tasks = new Map<string, Set<Promise<unknown>>>();
const deleting = new Set<string>();
const stopHandles = new Map<string, () => Promise<void>>();

function absolutePath(path: string) {
  const value = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (
    !value ||
    !/^(?:\/|[a-zA-Z]:\/)/.test(value) ||
    value.includes("\0") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Unsafe project workspace path.");
  }
  return value;
}

function allocatedPath(path: string) {
  const value = absolutePath(path);
  const separator = value.lastIndexOf("/");
  const name = value.slice(separator + 1);
  if (!/^[1-9]\d*-analysis-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw new Error("The path is not an allocated project analysis workspace.");
  const root = absolutePath(value.slice(0, separator));
  return { path: value, root, name };
}

async function exclusive<T>(key: string, action: () => Promise<T>) {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  const queued = previous.then(() => current);
  queues.set(key, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (queues.get(key) === queued) queues.delete(key);
  }
}

/** Host-only ledger: never infer project ownership from a paper/name prefix. */
export class ResearchWorkspaceProjectWorkspaceCleanup {
  constructor(private readonly ports: ProjectWorkspaceCleanupPorts) {}

  ledgerPath(projectID: string) {
    return `${researchProjectDirectory(this.ports.rootDir, projectID)}/workspace-allocations-v1.json`;
  }

  private handleKey(projectID: string, workspacePath: string) {
    return `${this.ledgerPath(projectID)}\0${allocatedPath(workspacePath).path}`;
  }

  private async assertSafeChain(root: string, path: string) {
    root = absolutePath(root);
    path = absolutePath(path);
    if (path !== root && !path.startsWith(`${root}/`))
      throw new Error("Workspace entry is outside its owned directory.");
    const paths = [root];
    if (path !== root) {
      const parts = path.slice(root.length + 1).split("/");
      for (let index = 1; index <= parts.length; index++)
        paths.push(`${root}/${parts.slice(0, index).join("/")}`);
    }
    for (const candidate of paths) {
      const kind = await this.ports.inspect(candidate);
      if (kind === "symlink")
        throw new Error(
          `Project cleanup refused a symbolic link: ${candidate}`,
        );
      if (candidate !== path && kind === "file")
        throw new Error(
          `A workspace directory was replaced by a file: ${candidate}`,
        );
    }
  }

  private async read(projectID: string): Promise<AllocationLedger> {
    assertResearchWorkspaceID(projectID, "projectID");
    const path = this.ledgerPath(projectID);
    await this.assertSafeChain(this.ports.rootDir, path);
    const text = await this.ports.readText(path);
    if (text === undefined)
      return { schemaVersion: 1, projectID, allocations: [] };
    if (text.length > 8_000_000)
      throw new Error("Workspace ledger is too large.");
    const value = JSON.parse(text) as AllocationLedger;
    if (
      value?.schemaVersion !== 1 ||
      value.projectID !== projectID ||
      !Array.isArray(value.allocations)
    ) {
      throw new Error("Project workspace ownership ledger is invalid.");
    }
    const seen = new Set<string>();
    for (const entry of value.allocations) {
      if (
        !entry ||
        typeof entry.workspacePath !== "string" ||
        typeof entry.canonicalRoot !== "string" ||
        typeof entry.cleanupConfirmed !== "boolean" ||
        typeof entry.launchAttempted !== "boolean" ||
        !["codex_cli", "claude_code"].includes(entry.mode)
      ) {
        throw new Error("Project workspace allocation is invalid.");
      }
      const allocation = allocatedPath(entry.workspacePath);
      absolutePath(entry.canonicalRoot);
      if (seen.has(allocation.path))
        throw new Error("Project workspace allocation is duplicated.");
      seen.add(allocation.path);
    }
    return value;
  }

  private async write(ledger: AllocationLedger) {
    const path = this.ledgerPath(ledger.projectID);
    await this.assertSafeChain(this.ports.rootDir, path);
    await this.ports.writeTextAtomic(
      path,
      `${JSON.stringify(ledger, null, 2)}\n`,
    );
  }

  async register(projectID: string, workspacePath: string, mode: EngineMode) {
    const path = this.ledgerPath(projectID);
    return exclusive(path, async () => {
      if (deleting.has(path))
        throw new Error("Project workspace deletion is in progress.");
      const allocation = allocatedPath(workspacePath);
      const ledger = await this.read(projectID);
      await this.ports.ensureDirectory(allocation.root);
      const canonicalRoot = absolutePath(
        await this.ports.canonicalDirectory(allocation.root),
      );
      const canonicalPath = `${canonicalRoot}/${allocation.name}`;
      await this.assertSafeChain(canonicalRoot, canonicalPath);
      if ((await this.ports.inspect(canonicalPath)) !== "missing")
        throw new Error(
          "A project workspace allocation already exists; it was preserved.",
        );
      if (
        ledger.allocations.some(
          (entry) => entry.workspacePath === allocation.path,
        )
      )
        throw new Error("A project workspace allocation cannot be reused.");
      ledger.allocations.push({
        workspacePath: allocation.path,
        canonicalRoot,
        mode,
        launchAttempted: false,
        cleanupConfirmed: false,
      });
      // The runner awaits this durable write before creating or staging files.
      await this.write(ledger);
    });
  }

  retainStopHandle(
    projectID: string,
    workspacePath: string,
    stop: () => Promise<void>,
  ) {
    stopHandles.set(this.handleKey(projectID, workspacePath), stop);
  }

  async markLaunching(projectID: string, workspacePath: string) {
    return exclusive(this.ledgerPath(projectID), async () => {
      if (deleting.has(this.ledgerPath(projectID)))
        throw new Error("Project workspace deletion is in progress.");
      const ledger = await this.read(projectID);
      const path = allocatedPath(workspacePath).path;
      const entry = ledger.allocations.find(
        (item) => item.workspacePath === path,
      );
      if (!entry)
        throw new Error("Project workspace allocation was not recorded.");
      entry.launchAttempted = true;
      await this.write(ledger);
      if (this.ports.confirmProcessStopped)
        this.retainStopHandle(projectID, workspacePath, () =>
          this.stopProcess(projectID, workspacePath),
        );
    });
  }

  async stopProcess(projectID: string, workspacePath: string) {
    const ledger = await this.read(projectID);
    const allocation = allocatedPath(workspacePath);
    const entry = ledger.allocations.find(
      (item) => item.workspacePath === allocation.path,
    );
    if (!entry)
      throw new Error("Project workspace allocation was not recorded.");
    await this.assertSafeChain(
      entry.canonicalRoot,
      `${entry.canonicalRoot}/${allocation.name}`,
    );
    const canonical = absolutePath(
      await this.ports.canonicalDirectory(allocation.root),
    );
    if (canonical !== entry.canonicalRoot)
      throw new Error(
        "The project workspace root now points to a different directory.",
      );
    if (!entry.launchAttempted || entry.cleanupConfirmed) return;
    if (!this.ports.confirmProcessStopped)
      throw new Error("CLI process ownership verification is unavailable.");
    await this.ports.confirmProcessStopped(allocation.path, entry.mode);
  }

  async confirmStopped(projectID: string, workspacePath: string) {
    return exclusive(this.ledgerPath(projectID), async () => {
      const ledger = await this.read(projectID);
      const allocation = allocatedPath(workspacePath);
      const entry = ledger.allocations.find(
        (item) => item.workspacePath === allocation.path,
      );
      if (!entry)
        throw new Error("Project workspace allocation was not recorded.");
      entry.cleanupConfirmed = true;
      await this.write(ledger);
      stopHandles.delete(this.handleKey(projectID, workspacePath));
    });
  }

  track<T>(projectID: string, task: Promise<T>) {
    const key = this.ledgerPath(projectID);
    const pending = tasks.get(key) ?? new Set<Promise<unknown>>();
    tasks.set(key, pending);
    pending.add(task);
    const settle = () => {
      pending.delete(task);
      if (!pending.size) tasks.delete(key);
    };
    // Attach both handlers immediately; deferred failures still remain unsafe
    // in the durable ledger and are retried by cleanup's retained stop handle.
    void task.then(settle, settle);
    return task;
  }

  run<T>(projectID: string, action: () => Promise<T>): Promise<T> {
    if (deleting.has(this.ledgerPath(projectID)))
      return Promise.reject(
        new Error("Project workspace deletion is in progress."),
      );
    return this.track(projectID, Promise.resolve().then(action));
  }

  async quiesce(projectID: string) {
    const key = this.ledgerPath(projectID);
    deleting.add(key);
    while (true) {
      const pending = tasks.get(key);
      if (!pending?.size) break;
      await Promise.allSettled([...pending]);
    }
    // Include an allocation write already admitted before the barrier closed.
    await exclusive(key, async () => {});
  }

  releaseDeletion(projectID: string) {
    const key = this.ledgerPath(projectID);
    if (tasks.get(key)?.size)
      throw new Error("Project workspace operations are still active.");
    deleting.delete(key);
  }

  /** Caller must quiesce project operations before invoking this method. */
  async cleanup(projectID: string): Promise<{ removedPaths: string[] }> {
    return exclusive(this.ledgerPath(projectID), async () => {
      if (tasks.get(this.ledgerPath(projectID))?.size)
        throw new Error("Project workspace operations are still active.");
      if (!deleting.has(this.ledgerPath(projectID)))
        throw new Error("Project workspaces must be quiesced before cleanup.");
      const ledger = await this.read(projectID);
      const plans: Array<{ entry: Allocation; paths: string[] }> = [];
      for (const entry of ledger.allocations) {
        const allocation = allocatedPath(entry.workspacePath);
        const rootMissing =
          (await this.ports.inspect(allocation.root)) === "missing";
        const canonicalRoot = rootMissing
          ? entry.canonicalRoot
          : absolutePath(await this.ports.canonicalDirectory(allocation.root));
        if (canonicalRoot !== entry.canonicalRoot)
          throw new Error(
            "The project workspace root now points to a different directory.",
          );
        const path = `${canonicalRoot}/${allocation.name}`;
        await this.assertSafeChain(canonicalRoot, path);
        const kind = await this.ports.inspect(path);
        if (kind !== "directory" && kind !== "missing")
          throw new Error("A project workspace was replaced by a file.");
        if (!entry.cleanupConfirmed) {
          const stop = stopHandles.get(
            this.handleKey(projectID, entry.workspacePath),
          );
          if (entry.launchAttempted && stop) {
            await stop();
          } else if (
            entry.launchAttempted &&
            this.ports.confirmProcessStopped
          ) {
            await this.stopProcess(projectID, entry.workspacePath);
          } else if (entry.launchAttempted) {
            const exitPath = `${path}/${entry.mode === "codex_cli" ? "codex" : "claude"}-exit.txt`;
            await this.assertSafeChain(canonicalRoot, exitPath);
            const exit = (await this.ports.readText(exitPath))?.trim();
            if (!exit || !/^\d{1,3}$/.test(exit) || Number(exit) > 255)
              throw new Error(
                `CLI stop is not confirmed for ${entry.workspacePath}. Stop the run and retry project deletion; its files were preserved.`,
              );
          }
          entry.cleanupConfirmed = true;
          await this.write(ledger);
          stopHandles.delete(this.handleKey(projectID, entry.workspacePath));
        }
        if (kind === "missing") continue;
        const paths: string[] = [];
        const visit = async (current: string): Promise<void> => {
          if (paths.length > 100_000)
            throw new Error("Project workspace contains too many files.");
          await this.assertSafeChain(canonicalRoot, current);
          const currentKind = await this.ports.inspect(current);
          if (currentKind === "directory") {
            for (const child of await this.ports.children(current)) {
              const childPath = absolutePath(child);
              if (childPath.slice(0, childPath.lastIndexOf("/")) !== current)
                throw new Error(
                  "Workspace listing returned an entry outside its directory.",
                );
              await visit(childPath);
            }
          }
          if (currentKind !== "missing") paths.push(current);
        };
        await visit(path);
        plans.push({ entry, paths });
      }
      const removedPaths: string[] = [];
      // Validate every tree before removing the first file. Nonrecursive
      // removal cannot follow a newly planted directory link into its target.
      for (const { entry, paths } of plans) {
        for (const path of paths) {
          await this.assertSafeChain(entry.canonicalRoot, path);
          await this.ports.remove(path);
        }
        removedPaths.push(entry.workspacePath);
      }
      return { removedPaths };
    });
  }
}

function nativeCleanup() {
  const runtime = globalThis as typeof globalThis & {
    Zotero?: typeof Zotero;
    IOUtils?: typeof IOUtils;
  };
  const io = runtime.IOUtils;
  const zotero = runtime.Zotero;
  if (!io || !zotero?.File?.pathToFile)
    throw new Error("Project workspace filesystem APIs are unavailable.");
  const files = createResearchWorkspaceStorage();
  const ports: ProjectWorkspaceCleanupPorts = {
    rootDir: getResearchWorkspaceStorageRoot(),
    ...files,
    async inspect(path) {
      const file = zotero.File.pathToFile(path);
      try {
        if (file.isSymlink()) return "symlink";
      } catch (error) {
        const name = (error as { name?: string })?.name;
        if (
          ![
            "NS_ERROR_FILE_NOT_FOUND",
            "NS_ERROR_FILE_TARGET_DOES_NOT_EXIST",
          ].includes(name ?? "")
        )
          throw error;
        if (!(await io.exists(path))) return "missing";
        throw error;
      }
      if (!(await io.exists(path))) return "missing";
      const info = await io.stat(path);
      if (info.type === "directory") return "directory";
      if (info.type === "regular") return "file";
      throw new Error(
        `Unsupported filesystem entry in project workspace: ${path}`,
      );
    },
    async canonicalDirectory(path) {
      const file = zotero.File.pathToFile(path);
      file.normalize();
      if (!file.isDirectory())
        throw new Error("Project workspace root is not a directory.");
      return file.path;
    },
    children: (path) => io.getChildren(path),
    async readText(path) {
      if (!(await io.exists(path))) return undefined;
      return files.readText(path);
    },
    remove: (path) => io.remove(path, { recursive: false, ignoreAbsent: true }),
    async confirmProcessStopped(workspacePath, mode) {
      await confirmProjectWorkspaceProcessStopped(workspacePath, mode, {
        async read(path) {
          const kind = await ports.inspect(path);
          if (kind === "missing") return undefined;
          if (kind !== "file")
            throw new Error(
              `Process ownership record is not a regular file: ${path}`,
            );
          return ports.readText(path);
        },
        async command(pid) {
          const internal = zotero.Utilities
            .Internal as typeof zotero.Utilities.Internal & {
            subprocess(executable: string, args: string[]): Promise<string>;
          };
          const result = parseExitStatusMarker(
            await internal.subprocess("/bin/zsh", [
              "-lc",
              withExitStatusMarker(`/bin/ps -ww -o command= -p ${pid}`),
            ]),
          );
          if (result.exitCode === 1 && !result.output.trim()) return undefined;
          if (result.exitCode !== 0 || !result.output.trim())
            throw new Error(
              "Could not verify the saved CLI process. Retry deletion.",
            );
          return result.output;
        },
        stop: (pid) => stopDetachedRunProcess(pid, { requireProcessId: true }),
      });
    },
  };
  return new ResearchWorkspaceProjectWorkspaceCleanup(ports);
}

export function projectWorkspaceCleanup() {
  return nativeCleanup();
}

export function cleanupResearchWorkspaceProjectWorkspaces(projectID: string) {
  return nativeCleanup().cleanup(projectID);
}

export function quiesceResearchWorkspaceProjectWorkspaces(projectID: string) {
  return nativeCleanup().quiesce(projectID);
}

export function releaseResearchWorkspaceProjectWorkspaceDeletion(
  projectID: string,
) {
  nativeCleanup().releaseDeletion(projectID);
}
