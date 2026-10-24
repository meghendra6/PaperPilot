import { strict as assert } from "node:assert";
import { test } from "node:test";
import { shellEscape } from "../src/modules/codex/shell";
import {
  confirmPersistedStudioJobStopped,
  stopNativeStudioJob,
  studioRuntimeJobs,
  type PersistedStudioProcessPorts,
} from "../src/modules/studio/nativeProcess";

function fixture() {
  const directory = "/profile/runtime/project/ai/job";
  const disk = new Map<string, string>();
  const stopped: string[] = [];
  let command: string | undefined;
  const ports: PersistedStudioProcessPorts = {
    read: async (path) => disk.get(path),
    command: async () => command,
    stop: async (pid) => {
      stopped.push(pid);
    },
  };
  return {
    directory,
    disk,
    stopped,
    ports,
    setCommand: (value: string | undefined) => {
      command = value;
    },
  };
}

test("persisted job recovery stops only the current process proved to own its exact directory", async () => {
  const f = fixture();
  f.disk.set(`${f.directory}/pid`, "4242");
  f.setCommand(`/bin/zsh -lc 'cat ${f.directory}/prompt.txt | codex'`);
  await confirmPersistedStudioJobStopped(f, f.ports);
  assert.deepEqual(f.stopped, ["4242"]);
  f.stopped.length = 0;
  f.setCommand(
    `/bin/zsh -lc 'cat ${f.directory}-different/prompt.txt | codex'`,
  );
  await assert.rejects(
    confirmPersistedStudioJobStopped(f, f.ports),
    /no longer identifies/,
  );
  assert.deepEqual(f.stopped, []);
  f.setCommand(undefined);
  await confirmPersistedStudioJobStopped(f, f.ports);
  assert.deepEqual(f.stopped, [], "An already dead saved PID needs no signal.");
});

test("unconfirmed persisted launch and failed termination remain retryable without assuming an empty registry is safe", async () => {
  const f = fixture();
  f.disk.set(`${f.directory}/launch-intent`, "studio-ai");
  await assert.rejects(
    confirmPersistedStudioJobStopped(f, f.ports),
    /no confirmed PID/,
  );
  f.disk.set(`${f.directory}/pid`, "1");
  await assert.rejects(
    confirmPersistedStudioJobStopped(f, f.ports),
    /Invalid saved/,
  );
  f.disk.set(`${f.directory}/pid`, "4242");
  f.setCommand(`codex --cd ${f.directory}/workspace`);
  await assert.rejects(
    confirmPersistedStudioJobStopped(f, {
      ...f.ports,
      stop: async () => {
        throw new Error("still running");
      },
    }),
    /still running/,
  );
  await confirmPersistedStudioJobStopped(f, f.ports);
  assert.deepEqual(f.stopped, ["4242"]);
});

test("prepared snapshots and confirmed stops are distinct from legacy jobs with missing PIDs", async () => {
  const f = fixture();
  f.disk.set(`${f.directory}/schema.json`, "{}");
  await assert.rejects(
    confirmPersistedStudioJobStopped(
      { ...f, launchFile: "schema.json" },
      f.ports,
    ),
    /no confirmed PID/,
  );
  f.disk.set(`${f.directory}/paperpilot-job-v1`, "prepared");
  await confirmPersistedStudioJobStopped(
    { ...f, launchFile: "schema.json" },
    f.ports,
  );
  f.disk.set(`${f.directory}/launch-intent`, "studio-ai");
  await assert.rejects(
    confirmPersistedStudioJobStopped(f, f.ports),
    /no confirmed PID/,
  );
  f.disk.set(`${f.directory}/process-stopped`, "stopped");
  await confirmPersistedStudioJobStopped(f, f.ports);
  assert.deepEqual(f.stopped, []);
});

test("runtime recovery scans exact job levels without treating project files or other projects as process records", async () => {
  const root = "/profile";
  const entries: Record<string, string[]> = {
    "/profile/runtime/project": [
      "/profile/runtime/project/ai",
      "/profile/runtime/project/notebook",
    ],
    "/profile/runtime/project/ai": ["/profile/runtime/project/ai/job"],
    "/profile/runtime/project/notebook": [
      "/profile/runtime/project/notebook/kernel",
    ],
    "/profile/runtime/builds/project": [
      "/profile/runtime/builds/project/build",
    ],
    "/profile/runtime/context/project": [
      "/profile/runtime/context/project/context",
    ],
    "/profile/runtime/context/project/context": [
      "/profile/runtime/context/project/context/run",
    ],
  };
  const visited: string[] = [];
  const jobs = await studioRuntimeJobs(root, "project", {
    directories: async (path) => {
      visited.push(path);
      return entries[path] ?? [];
    },
  });
  assert.deepEqual(
    jobs.map((job) => job.directory),
    [
      "/profile/runtime/project/ai/job",
      "/profile/runtime/project/notebook/kernel",
      "/profile/runtime/builds/project/build",
      "/profile/runtime/context/project/context/run",
    ],
  );
  assert.equal(jobs.at(-1)?.pidFile, "extractor-pid.txt");
  assert.ok(
    !visited.some(
      (path) => path.includes("/workspace") || path.includes("/projects/"),
    ),
  );
});

test("native retained-job retries verify current command ownership and reject malformed exit markers", async (t) => {
  const globals = globalThis as any;
  const priorZotero = globals.Zotero;
  const priorIO = globals.IOUtils;
  t.after(() => {
    globals.Zotero = priorZotero;
    globals.IOUtils = priorIO;
  });
  const directory = "/owned/native-retained/job";
  const disk = new Map([
    [`${directory}/pid`, "4242"],
    [`${directory}/exit-code`, "file-read-error"],
  ]);
  let signals = 0;
  let command = "/bin/other-user-process";
  globals.IOUtils = {
    exists: async (path: string) => disk.has(path),
    stat: async () => ({ type: "regular" }),
    writeUTF8: async (path: string, text: string) => {
      disk.set(path, text);
    },
    remove: async () => {},
  };
  globals.Zotero = {
    File: {
      getContentsAsync: async (path: string) => disk.get(path),
      createDirectoryIfMissingAsync: async () => {},
      putContentsAsync: async () => {},
    },
    Promise: { delay: async () => {} },
    Utilities: {
      Internal: {
        subprocess: async () => `${command}\n__PAPERPILOT_EXIT__=0\n`,
        exec: async () => {
          signals++;
        },
      },
    },
  };
  await assert.rejects(
    stopNativeStudioJob({ directory }),
    /no longer identifies/,
  );
  assert.equal(signals, 0);
  command = `/bin/zsh -lc cat ${directory}/prompt.txt`;
  await stopNativeStudioJob({ directory });
  assert.equal(signals, 1);
  assert.equal(disk.get(`${directory}/process-stopped`), "stopped");
  command = "/bin/recycled-pid";
  await stopNativeStudioJob({ directory });
  assert.equal(
    signals,
    1,
    "Confirmed cleanup must not signal a later recycled PID.",
  );
});

test("process ownership recognizes shell-quoted paths without broadening the directory prefix", async () => {
  const directory = "/profile/O'Brien/runtime/project/job";
  const stopped: string[] = [];
  await confirmPersistedStudioJobStopped(
    { directory },
    {
      read: async (path) => (path.endsWith("/pid") ? "4242" : undefined),
      command: async () =>
        `/bin/zsh -lc cat ${shellEscape(`${directory}/prompt.txt`)}`,
      stop: async (pid) => {
        stopped.push(pid);
      },
    },
  );
  assert.deepEqual(stopped, ["4242"]);
});

test("legacy notebook IDs named ai cannot hide kernel launch evidence from the runtime scan", async () => {
  const f = fixture();
  f.disk.set(`${f.directory}/input.txt`, "");
  await assert.rejects(
    confirmPersistedStudioJobStopped(
      { ...f, launchFile: "schema.json" },
      f.ports,
    ),
    /no confirmed PID/,
  );
  assert.deepEqual(f.stopped, []);
});
