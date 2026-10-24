import {
  assertDocumentName,
  documentByteLength,
  type StudioDocument,
} from "./contracts";
import type { StudioRepository } from "./repository";
import { assertRuntimeSnapshotPaths } from "./documentIdentity";

export type StudioCompiler = "tectonic" | "typst" | "myst";
export interface CompileJob {
  directory: string;
  executable: string;
  environment?: Record<string, string | undefined>;
}
export interface CompileResult {
  status: "complete" | "failed" | "canceled";
  compiler: StudioCompiler;
  source: { id: string; name: string; revision: number };
  inputs: { id: string; name: string; revision: number }[];
  log: string;
  output?: StudioDocument;
}
export interface CompilerPorts {
  /** Stable project build path, including across replacement Studio windows. */
  scope: string;
  id(): string;
  prepare(compiler: StudioCompiler): Promise<CompileJob>;
  writeBase64(path: string, base64: string): Promise<void>;
  readBase64(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string | undefined>;
  log(path: string): Promise<string>;
  launch(job: CompileJob, command: string[]): Promise<void>;
  stop(job: CompileJob): Promise<void>;
  delay(ms: number): Promise<void>;
  templates?: {
    restore(job: CompileJob): Promise<void>;
    retain(job: CompileJob): Promise<void>;
  };
}

// A closed window can leave a build awaiting cancellation or failed cleanup.
// Keep admission and process ownership until another service confirms the stop.
const compilerStates = new Map<
  string,
  { owner?: StudioCompilerService; cleanupJob?: CompileJob }
>();

export function compilerFor(name: string): StudioCompiler {
  if (/\.tex$/i.test(name)) return "tectonic";
  if (/\.typ$/i.test(name)) return "typst";
  if (/\.(md|markdown|myst)$/i.test(name)) return "myst";
  throw new Error(
    "PDF builds support LaTeX, Typst, and MyST Markdown sources.",
  );
}

export function compilerCommand(
  compiler: StudioCompiler,
  job: CompileJob,
  name: string,
) {
  assertDocumentName(name);
  const workspace = `${job.directory}/workspace`;
  const input = `${workspace}/${name}`;
  const output = `${job.directory}/output`;
  if (compiler === "tectonic")
    return {
      command: [
        job.executable,
        "--untrusted",
        "--keep-logs",
        "--color",
        "never",
        "--outdir",
        output,
        input,
      ],
      pdf: `${output}/${name
        .split("/")
        .at(-1)!
        .replace(/\.tex$/i, ".pdf")}`,
    };
  const pdf = `${output}/document.pdf`;
  return {
    command:
      compiler === "typst"
        ? [
            job.executable,
            "compile",
            "--root",
            workspace,
            "--diagnostic-format",
            "short",
            input,
            pdf,
          ]
        : [
            job.executable,
            "build",
            input,
            "--typst",
            "--output",
            pdf,
            "--ci",
            "--force",
            "--strict",
          ],
    pdf,
  };
}

/** Runs only on an explicit Build action. Inputs are immutable saved revisions. */
export class StudioCompilerService {
  private running?: { canceled: boolean };
  constructor(
    private projectID: string,
    private repository: StudioRepository,
    private ports: CompilerPorts,
  ) {}

  cancel() {
    if (this.running) this.running.canceled = true;
  }

  async build(id: string, expectedRevision: number): Promise<CompileResult> {
    const state = compilerStates.get(this.ports.scope) ?? {};
    if (state.owner) throw new Error("A project build is already running.");
    state.owner = this;
    compilerStates.set(this.ports.scope, state);
    const run = { canceled: false };
    this.running = run;
    let job: CompileJob | undefined;
    let launched = false;
    let exited = false;
    let result: CompileResult | undefined;
    const check = () => {
      if (run.canceled) throw new Error("Build canceled.");
    };
    try {
      if (state.cleanupJob) {
        try {
          await this.ports.stop(state.cleanupJob);
          state.cleanupJob = undefined;
        } catch (error) {
          throw new Error(
            `Previous compiler cleanup is unconfirmed. Retry after resolving the process error: ${String(error)}`,
          );
        }
      }
      check();
      const manifest = await this.repository.list(this.projectID);
      const selected = manifest.documents.find((doc) => doc.id === id);
      if (
        !selected ||
        selected.archived ||
        selected.revision !== expectedRevision
      )
        throw new Error(
          "The source changed. Save and open its current revision before building.",
        );
      const source = await this.repository.read(
        this.projectID,
        id,
        selected.versions.at(-1)!.revision,
      );
      const compiler = compilerFor(selected.name);
      const documents = manifest.documents.filter((doc) => !doc.archived);
      const needsMystConfig =
        compiler === "myst" &&
        !documents.some((doc) => doc.name === "myst.yml");
      assertRuntimeSnapshotPaths([
        ...documents.map((doc) => doc.name),
        ...(needsMystConfig ? ["myst.yml"] : []),
      ]);
      result = {
        status: "failed",
        compiler,
        source: { id, name: selected.name, revision: selected.revision },
        inputs: [],
        log: "",
      };
      job = await this.ports.prepare(compiler);
      check();
      if (compiler === "myst") await this.ports.templates?.restore(job);
      let total = 0;
      for (const document of documents) {
        check();
        const saved =
          document.id === id
            ? source
            : await this.repository.read(
                this.projectID,
                document.id,
                document.versions.at(-1)!.revision,
              );
        total += documentByteLength(saved.base64);
        if (total > 100 * 1024 * 1024)
          throw new Error(
            "This project exceeds the 100 MiB build snapshot limit.",
          );
        assertDocumentName(document.name);
        const name = document.name;
        await this.ports.writeBase64(
          `${job.directory}/workspace/${name}`,
          saved.base64,
        );
        result.inputs.push({
          id: document.id,
          name,
          revision: saved.version.revision,
        });
      }
      // MyST needs a project root; preserve any user-supplied configuration.
      if (needsMystConfig)
        await this.ports.write(
          `${job.directory}/workspace/myst.yml`,
          "version: 1\nproject: {}\n",
        );
      const command = compilerCommand(compiler, job, selected.name);
      check();
      // A child can start before the detached launch acknowledgment fails.
      launched = true;
      await this.ports.launch(job, command.command);
      const deadline = Date.now() + 240000;
      for (;;) {
        check();
        const code = await this.ports.read(`${job.directory}/exit-code`);
        if (code !== undefined) {
          exited = true;
          if (code.trim() !== "0")
            throw new Error(
              `Compiler exited with code ${code.trim() || "unknown"}.`,
            );
          break;
        }
        if (Date.now() >= deadline)
          throw new Error("Build exceeded four minutes. See the compiler log.");
        await this.ports.delay(800);
      }
      check();
      const base64 = await this.ports.readBase64(command.pdf);
      documentByteLength(base64);
      if (!base64.startsWith("JVBERi0"))
        throw new Error("The compiler did not produce a PDF file.");
      check();
      const stem = selected.name
        .split("/")
        .at(-1)!
        .replace(/\.[^.]+$/, "")
        .slice(0, 80);
      result.output = await this.repository.create(
        this.projectID,
        `exports/${stem}-r${expectedRevision}-${this.ports.id()}.pdf`,
        base64,
        "You · compiler",
      );
      result.status = "complete";
      if (compiler === "myst") {
        try {
          await this.ports.templates?.retain(job);
        } catch (error) {
          result.log += `\nPDF built, but template reuse could not be recorded: ${String(error)}`;
        }
      }
    } catch (error) {
      if (!result) throw error;
      result.status = run.canceled ? "canceled" : "failed";
      result.log = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        if (job && launched && !exited) await this.ports.stop(job);
      } catch (error) {
        state.cleanupJob = job;
        if (result) result.log += `\nProcess cleanup: ${String(error)}`;
      }
      if (job && result) {
        try {
          result.log += `\n${await this.ports.log(`${job.directory}/stdout.txt`)}\n${await this.ports.log(`${job.directory}/stderr.txt`)}`;
          await this.ports.write(
            `${job.directory}/result.json`,
            JSON.stringify(result),
          );
        } catch (error) {
          result.log += `\nLog persistence: ${String(error)}`;
        }
      }
      this.running = undefined;
      state.owner = undefined;
      if (!state.cleanupJob && compilerStates.get(this.ports.scope) === state)
        compilerStates.delete(this.ports.scope);
    }
    return result!;
  }
}
