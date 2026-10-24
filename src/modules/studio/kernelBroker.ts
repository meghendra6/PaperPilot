import { assertStudioID } from "./contracts";
import {
  assertExecutionReceipt,
  type ExecutionReceipt,
} from "./outputProvenance";

export interface KernelResult {
  execution?: ExecutionReceipt;
  status: "ok" | "error";
  execution_count: number | null;
  outputs: Array<Record<string, any>>;
  displayIDs?: Record<string, string>;
  displayUpdates?: Array<{
    displayID: string;
    data: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
}

export interface KernelPorts {
  /** Stable profile/project runtime path, shared by replacement windows. */
  scope: string;
  createJob(documentID: string, kernel: "python3" | "ir"): Promise<string>;
  read(path: string): Promise<string | undefined>;
  write(path: string, contents: string): Promise<void>;
  launch(directory: string, kernel: "python3" | "ir"): Promise<void>;
  kill(directory: string): Promise<void>;
  id(): string;
  delay(ms: number): Promise<void>;
}

interface Session {
  id: string;
  inputs: ExecutionReceipt["inputs"];
  directory: string;
  kernel: "python3" | "ir";
  busy: boolean;
  requestID?: string;
  failed?: boolean;
  heartbeat: ReturnType<typeof setInterval>;
}

// A window can close before startup or termination settles. Retain the owner
// until cleanup is confirmed; a replacement never adopts a live session.
const kernelOwners = new Map<string, KernelBroker>();

/** Kernels belong to documents, independently of paper/CLI run reservations. */
export class KernelBroker {
  private sessions = new Map<string, Session>();
  private starting = new Map<string, Promise<Session>>();
  private restarting = new Map<string, Promise<void>>();
  private executionEpochs = new Map<string, number>();
  private closed = false;
  private writes = new Set<Promise<void>>();

  /** Includes owners retained after an earlier window's cleanup failed. */
  static async closeScope(scope: string, kill: KernelPorts["kill"]) {
    const owners = [...new Set(kernelOwners.values())].filter(
      (owner) => owner.ports.scope === scope,
    );
    const results = await Promise.allSettled(
      owners.map((owner) => owner.closeWithKill(kill)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  private write(path: string, contents: string) {
    const operation = this.ports.write(path, contents);
    this.writes.add(operation);
    void operation.then(
      () => this.writes.delete(operation),
      () => this.writes.delete(operation),
    );
    return operation;
  }
  constructor(private ports: KernelPorts) {}

  private ownershipKey(documentID: string) {
    return `${this.ports.scope}/${documentID}`;
  }

  private releaseOwnership(documentID: string) {
    const key = this.ownershipKey(documentID);
    if (
      !this.sessions.has(documentID) &&
      !this.starting.has(documentID) &&
      !this.restarting.has(documentID) &&
      kernelOwners.get(key) === this
    )
      kernelOwners.delete(key);
  }

  private async poll(directory: string, name: string, timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const text = await this.ports.read(`${directory}/${name}`);
      if (text !== undefined) return JSON.parse(text);
      const exit = await this.ports.read(`${directory}/exit-code`);
      if (exit !== undefined)
        throw new Error(
          `The notebook worker exited (${exit.trim()}). Check the configured Python environment and its Jupyter packages.`,
        );
      if (
        name !== "ready.json" &&
        (await this.ports.read(`${directory}/stopped.json`))
      )
        throw new Error("The kernel stopped. Restart it before continuing.");
      await this.ports.delay(200);
    }
    throw new Error(
      "The kernel did not confirm the operation. Interrupt or restart it before continuing.",
    );
  }

  private start(
    documentID: string,
    kernel: "python3" | "ir",
  ): Promise<Session> {
    assertStudioID(documentID);
    if (this.closed) throw new Error("This project window is closed.");
    const owner = kernelOwners.get(this.ownershipKey(documentID));
    if (owner && owner !== this)
      throw new Error(
        "The previous window still owns this kernel. Restart the kernel before running a cell.",
      );
    if (this.restarting.has(documentID))
      throw new Error("This kernel is restarting. Wait before running a cell.");
    if (kernel !== "python3" && kernel !== "ir")
      throw new Error("Choose a Python or R kernel.");
    const current = this.sessions.get(documentID);
    if (current) {
      if (current.kernel !== kernel)
        throw new Error("Restart the kernel after changing language.");
      return Promise.resolve(current);
    }
    const pending = this.starting.get(documentID);
    if (pending) return pending;
    kernelOwners.set(this.ownershipKey(documentID), this);
    const promise = (async () => {
      const directory = await this.ports.createJob(documentID, kernel);
      if (this.closed) throw new Error("This project window is closed.");
      await this.write(`${directory}/heartbeat`, "alive");
      const session: Session = {
        id: this.ports.id(),
        inputs: JSON.parse(
          (await this.ports.read(`${directory}/inputs.json`)) ?? "[]",
        ),
        directory,
        kernel,
        busy: false,
        heartbeat: setInterval(() => {
          void this.write(`${directory}/heartbeat`, "alive").catch(() =>
            clearInterval(session.heartbeat),
          );
        }, 5000),
      };
      try {
        await this.ports.launch(directory, kernel);
        const ready = await this.poll(directory, "ready.json", 40000);
        if (!ready.ok)
          throw new Error(
            `Kernel unavailable: ${ready.error}. Configure the Studio Python environment in Paper Pilot settings.`,
          );
        if (this.closed)
          throw new Error(
            "This project window closed while starting its kernel.",
          );
        this.sessions.set(documentID, session);
        return session;
      } catch (error) {
        clearInterval(session.heartbeat);
        await Promise.allSettled([...this.writes]);
        try {
          await this.ports.kill(directory);
        } catch (cleanup) {
          // Launch may have started a worker before its acknowledgement failed.
          // Keep its directory owned so retry/close can terminate it, and block
          // another worker until that termination has been confirmed.
          session.failed = true;
          this.sessions.set(documentID, session);
          throw new Error(
            `${String(error)} Cleanup could not be confirmed: ${String(cleanup)}`,
          );
        }
        throw error;
      }
    })().finally(() => {
      this.starting.delete(documentID);
      this.releaseOwnership(documentID);
    });
    this.starting.set(documentID, promise);
    return promise;
  }

  async execute(
    documentID: string,
    kernel: "python3" | "ir",
    code: string,
  ): Promise<KernelResult> {
    if (
      typeof code !== "string" ||
      new TextEncoder().encode(code).length > 1024 * 1024
    )
      throw new Error("A cell must contain at most 1 MiB of source.");
    const epoch = this.executionEpochs.get(documentID) ?? 0;
    const session = await this.start(documentID, kernel);
    if ((this.executionEpochs.get(documentID) ?? 0) !== epoch)
      throw new Error("Cell execution canceled before it started.");
    if (this.closed || this.sessions.get(documentID) !== session)
      throw new Error("This kernel session has closed.");
    if (session.kernel !== kernel)
      throw new Error("Restart the kernel after changing language.");
    if (session.failed)
      throw new Error(
        "Restart this kernel before continuing after an unconfirmed execution.",
      );
    if (session.busy)
      throw new Error("A cell is already running in this notebook.");
    session.busy = true;
    const id = this.ports.id();
    const startedAt = new Date().toISOString();
    assertStudioID(id);
    session.requestID = id;
    try {
      await this.write(
        `${session.directory}/request.json`,
        JSON.stringify({ id, code }),
      );
      const result: KernelResult = await this.poll(
        session.directory,
        `response-${id}.json`,
        130000,
      );
      const execution: ExecutionReceipt = {
        schemaVersion: 1,
        id,
        sessionID: session.id,
        notebookID: documentID,
        kernel,
        code,
        startedAt,
        completedAt: new Date().toISOString(),
        inputs: session.inputs,
      };
      assertExecutionReceipt(execution);
      return { ...result, execution };
    } catch (error) {
      session.failed = true;
      throw error;
    } finally {
      session.busy = false;
      session.requestID = undefined;
    }
  }

  async interrupt(documentID: string) {
    if (
      this.closed ||
      this.restarting.has(documentID) ||
      kernelOwners.get(this.ownershipKey(documentID)) !== this
    )
      return;
    this.executionEpochs.set(
      documentID,
      (this.executionEpochs.get(documentID) ?? 0) + 1,
    );
    const session = this.sessions.get(documentID);
    if (session?.requestID)
      await this.write(
        `${session.directory}/interrupt`,
        JSON.stringify({ id: session.requestID }),
      );
  }

  restart(documentID: string): Promise<void> {
    assertStudioID(documentID);
    const owner = kernelOwners.get(this.ownershipKey(documentID));
    if (owner && owner !== this) {
      // A late close/restart from a disposed window must not stop its successor.
      if (this.closed) return Promise.resolve();
      if (!owner.closed)
        return Promise.reject(
          new Error(
            "This kernel is still owned by another open project window.",
          ),
        );
      // The old window's native capabilities may no longer be usable. The new
      // broker supplies termination only; no session or kernel state is adopted.
      return owner.restartOwned(documentID, (directory) =>
        this.ports.kill(directory),
      );
    }
    return this.restartOwned(documentID, (directory) =>
      this.ports.kill(directory),
    );
  }

  private restartOwned(
    documentID: string,
    kill: KernelPorts["kill"],
  ): Promise<void> {
    const pending = this.restarting.get(documentID);
    if (pending) return pending;
    this.executionEpochs.set(
      documentID,
      (this.executionEpochs.get(documentID) ?? 0) + 1,
    );
    const operation = Promise.resolve()
      .then(async () => {
        // A failed start may retain an unconfirmed worker for this cleanup.
        await this.starting.get(documentID)?.catch(() => {});
        const session = this.sessions.get(documentID);
        if (!session) return;
        session.failed = true;
        clearInterval(session.heartbeat);
        await Promise.allSettled([...this.writes]);
        await kill(session.directory);
        if (this.sessions.get(documentID) === session)
          this.sessions.delete(documentID);
      })
      .finally(() => {
        if (this.restarting.get(documentID) === operation)
          this.restarting.delete(documentID);
        this.releaseOwnership(documentID);
      });
    this.restarting.set(documentID, operation);
    return operation;
  }

  private async closeWithKill(kill: KernelPorts["kill"]) {
    this.closed = true;
    for (const session of this.sessions.values())
      clearInterval(session.heartbeat);
    await Promise.allSettled([...this.starting.values()]);
    // An earlier close may still use a disposed window's capabilities. Wait
    // for that attempt, then retry any retained session with the fresh port.
    await Promise.allSettled([...this.restarting.values()]);
    for (const session of this.sessions.values())
      clearInterval(session.heartbeat);
    await Promise.allSettled([...this.writes]);
    const results = await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.restartOwned(id, kill)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  close() {
    return this.closeWithKill((directory) => this.ports.kill(directory));
  }
}
