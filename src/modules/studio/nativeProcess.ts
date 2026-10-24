import { stopDetachedRunProcess } from "../ai/runCompletion";
import { shellEscape } from "../codex/shell";
import { createResearchWorkspaceStorage } from "../researchWorkspace/storage";
import {
  parseExitStatusMarker,
  withExitStatusMarker,
} from "../ai/subprocessStatus";

declare const Zotero: any;
declare const IOUtils: any;

/** Fresh storage/process ports remain usable after the creating window closes. */
export async function stopNativeStudioJob(job: { directory: string }) {
  const files = createResearchWorkspaceStorage();
  const ports = nativeProcessPorts();
  if ((await ports.read(`${job.directory}/process-stopped`)) === "stopped")
    return;
  for (let attempt = 0; attempt < 10; attempt++) {
    const exit = await ports.read(`${job.directory}/exit-code`);
    if (exit !== undefined && /^-?\d+$/.test(exit.trim())) return;
    const pid = (await ports.read(`${job.directory}/pid`))?.trim();
    if (pid) {
      await confirmPersistedStudioJobStopped(job, ports);
      await files.writeTextAtomic(
        `${job.directory}/process-stopped`,
        "stopped",
      );
      return;
    }
    await Zotero.Promise.delay(100);
  }
  throw new Error(
    `Could not confirm the project process stopped. Retry deletion after resolving the process error: ${job.directory}.`,
  );
}

export interface PersistedStudioJob {
  directory: string;
  pidFile?: string;
  exitFile?: string;
  launchFile?: string;
}

export interface PersistedStudioProcessPorts {
  read(path: string): Promise<string | undefined>;
  command(pid: string): Promise<string | undefined>;
  stop(pid: string): Promise<void>;
}

/** Old PID files are not authority to signal an unrelated, recycled PID. */
export async function confirmPersistedStudioJobStopped(
  job: PersistedStudioJob,
  ports: PersistedStudioProcessPorts,
) {
  if ((await ports.read(`${job.directory}/process-stopped`)) === "stopped")
    return;
  const exit = await ports.read(
    `${job.directory}/${job.exitFile ?? "exit-code"}`,
  );
  const pid = (
    await ports.read(`${job.directory}/${job.pidFile ?? "pid"}`)
  )?.trim();
  if (exit !== undefined && /^-?\d+$/.test(exit.trim())) return;
  if (!pid) {
    let launch = await ports.read(`${job.directory}/launch-intent`);
    const prepared = await ports.read(`${job.directory}/paperpilot-job-v1`);
    if (launch === undefined && prepared === "prepared") return;
    // Legacy jobs had no explicit launch intent. Only their launch inputs can
    // conservatively distinguish an unused snapshot from a possible process.
    if (launch === undefined && job.launchFile) {
      launch = await ports.read(`${job.directory}/${job.launchFile}`);
      // Restored notebook IDs can equal "ai", so the directory label alone
      // cannot distinguish a legacy kernel from an AI job.
      if (launch === undefined && job.launchFile === "schema.json")
        launch = await ports.read(`${job.directory}/input.txt`);
    }
    if (launch === undefined) return;
    throw new Error(
      `Process launch has no confirmed PID or exit status: ${job.directory}.`,
    );
  }
  if (
    !/^[1-9]\d*$/.test(pid) ||
    !Number.isSafeInteger(Number(pid)) ||
    Number(pid) <= 1
  )
    throw new Error(`Invalid saved process identity: ${job.directory}.`);
  const command = await ports.command(pid);
  if (command === undefined) return;
  const prefix = `${job.directory}/`;
  if (
    !command.includes(prefix) &&
    !command.includes(shellEscape(prefix).slice(1, -1))
  )
    throw new Error(
      `Saved PID ${pid} no longer identifies the owned project job. No process was stopped: ${job.directory}.`,
    );
  await ports.stop(pid);
}

export interface StudioRuntimeScanPorts {
  directories(path: string): Promise<string[]>;
}

/** Exact known job levels only; project documents named "pid" are not jobs. */
export async function studioRuntimeJobs(
  root: string,
  projectID: string,
  ports: StudioRuntimeScanPorts,
) {
  const jobs: PersistedStudioJob[] = [];
  for (const kind of await ports.directories(`${root}/runtime/${projectID}`))
    for (const directory of await ports.directories(kind))
      jobs.push({
        directory,
        launchFile: kind.endsWith("/ai") ? "schema.json" : "input.txt",
      });
  for (const directory of await ports.directories(
    `${root}/runtime/builds/${projectID}`,
  ))
    jobs.push({ directory, launchFile: "input.txt" });
  for (const context of await ports.directories(
    `${root}/runtime/context/${projectID}`,
  ))
    for (const directory of await ports.directories(context))
      jobs.push({
        directory,
        pidFile: "extractor-pid.txt",
        exitFile: "extractor-exit.txt",
      });
  return jobs;
}

function nativeProcessPorts(): PersistedStudioProcessPorts {
  const files = createResearchWorkspaceStorage();
  return {
    read: async (path) => {
      if (!(await files.exists(path))) return undefined;
      const info = await IOUtils.stat(path, { followSymlinks: false });
      if (info.type !== "regular")
        throw new Error(
          `Process ownership record is not a regular file: ${path}.`,
        );
      return files.readText(path);
    },
    command: async (pid) => {
      const result = parseExitStatusMarker(
        await Zotero.Utilities.Internal.subprocess("/bin/zsh", [
          "-lc",
          withExitStatusMarker(`/bin/ps -ww -o command= -p ${pid}`),
        ]),
      );
      if (result.exitCode === 1 && !result.output.trim()) return undefined;
      if (result.exitCode !== 0 || !result.output.trim())
        throw new Error(
          `Could not verify saved process ${pid}. Retry deletion.`,
        );
      return result.output;
    },
    stop: (pid) => stopDetachedRunProcess(pid, { requireProcessId: true }),
  };
}

/** Caller must preflight the owned roots for symlinks before this scan. */
export async function quiescePersistedStudioProcesses(
  root: string,
  projectID: string,
) {
  const files = createResearchWorkspaceStorage();
  const jobs = await studioRuntimeJobs(root, projectID, {
    directories: async (path) => {
      if (!(await IOUtils.exists(path))) return [];
      const result: string[] = [];
      for (const child of await IOUtils.getChildren(path)) {
        const info = await IOUtils.stat(child, { followSymlinks: false });
        if (info.type === "symlink" || info.type === "other")
          throw new Error(
            `Project runtime contains a symbolic link: ${child}.`,
          );
        if (info.type === "directory") result.push(child);
      }
      return result;
    },
  });
  const ports = nativeProcessPorts();
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      await confirmPersistedStudioJobStopped(job, ports);
      // Preserve confirmed shutdown if a later directory removal fails and
      // deletion is retried after the operating system has recycled the PID.
      await files.writeTextAtomic(
        `${job.directory}/process-stopped`,
        "stopped",
      );
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
