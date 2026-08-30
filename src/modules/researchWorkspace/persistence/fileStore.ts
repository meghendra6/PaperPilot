import {
  ResearchWorkspaceRevisionConflictError,
  type ResearchWorkspaceFileOps,
} from "./contracts";
import { parseStoredJSON } from "./validation";

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export class SerializedResearchWorkspaceFiles {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly fileOps: ResearchWorkspaceFileOps) {}

  private async exclusive<T>(path: string, action: () => Promise<T>) {
    const previous = this.queues.get(path) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(path, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.queues.get(path) === queued) this.queues.delete(path);
    }
  }

  async read<T>(path: string, parser: (value: unknown) => T) {
    if (!(await this.fileOps.exists(path))) return undefined;
    const contents = await this.fileOps.readText(path);
    if (contents === undefined) return undefined;
    return clone(parseStoredJSON(contents, path, parser));
  }

  async writeNew<T extends { revision: number }>(path: string, value: T) {
    return this.exclusive(path, async () => {
      if (await this.fileOps.exists(path)) {
        throw new ResearchWorkspaceRevisionConflictError(path, 0, 1);
      }
      const next = { ...clone(value), revision: 1 };
      await this.fileOps.writeTextAtomic(
        path,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      return next;
    });
  }

  async mutate<T extends { revision: number }>(params: {
    path: string;
    parser: (value: unknown) => T;
    expectedRevision?: number;
    create?: () => T;
    mutate: (current: T) => T | undefined;
  }) {
    return this.exclusive(params.path, async () => {
      let current: T | undefined;
      if (await this.fileOps.exists(params.path)) {
        const contents = await this.fileOps.readText(params.path);
        if (contents !== undefined) {
          current = parseStoredJSON(contents, params.path, params.parser);
        }
      }
      if (!current) current = params.create?.();
      if (!current)
        throw new Error(`Research Workspace file is missing: ${params.path}`);
      if (
        params.expectedRevision !== undefined &&
        current.revision !== params.expectedRevision
      ) {
        throw new ResearchWorkspaceRevisionConflictError(
          params.path,
          params.expectedRevision,
          current.revision,
        );
      }
      const candidate = params.mutate(clone(current));
      if (candidate === undefined) return clone(current);
      const next = {
        ...clone(candidate),
        revision: current.revision + 1,
      } as T;
      await this.fileOps.writeTextAtomic(
        params.path,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      return clone(next);
    });
  }

  async remove(path: string, options?: { recursive?: boolean }) {
    return this.exclusive(path, () => this.fileOps.remove(path, options));
  }

  async replace<T extends { revision: number }>(path: string, value: T) {
    return this.exclusive(path, async () => {
      const next = clone(value);
      await this.fileOps.writeTextAtomic(
        path,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      return clone(next);
    });
  }

  ensureDirectory(path: string) {
    return this.fileOps.ensureDirectory(path);
  }

  listDirectory(path: string) {
    return this.fileOps.listDirectory(path);
  }

  exists(path: string) {
    return this.fileOps.exists(path);
  }
}

export function cloneResearchWorkspaceValue<T>(value: T) {
  return clone(value);
}
