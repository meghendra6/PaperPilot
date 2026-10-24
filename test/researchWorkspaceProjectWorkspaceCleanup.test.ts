import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResearchWorkspaceProjectWorkspaceCleanup,
  confirmProjectWorkspaceProcessStopped,
  type ProjectWorkspaceCleanupPorts,
} from "../src/modules/researchWorkspace/persistence/projectWorkspaceCleanup";
import { shellEscape } from "../src/modules/codex/shell";

async function fixture(t: { after(action: () => Promise<void>): void }) {
  const base = await fs.mkdtemp(join(tmpdir(), "paperpilot-project-cleanup-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const removed: string[] = [];
  const ports: ProjectWorkspaceCleanupPorts = {
    rootDir: `${base}/profile/연구`,
    async inspect(path) {
      try {
        const entry = await fs.lstat(path);
        return entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : "file";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return "missing";
        throw error;
      }
    },
    canonicalDirectory: (path) => fs.realpath(path),
    async children(path) {
      return (await fs.readdir(path)).map((name) => `${path}/${name}`);
    },
    async ensureDirectory(path) {
      await fs.mkdir(path, { recursive: true });
    },
    async readText(path) {
      try {
        return await fs.readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    },
    async writeTextAtomic(path, text) {
      await fs.mkdir(join(path, ".."), { recursive: true });
      await fs.writeFile(`${path}.tmp`, text);
      await fs.rename(`${path}.tmp`, path);
    },
    async remove(path) {
      const entry = await ports.inspect(path);
      if (entry === "directory") await fs.rmdir(path);
      else if (entry !== "missing") await fs.unlink(path);
      removed.push(path);
    },
  };
  const cleanup = new ResearchWorkspaceProjectWorkspaceCleanup(ports);
  const workspace = (name = "1-analysis-a-1-run") => `${base}/work/${name}`;
  const put = async (path: string, text = "owned output") => {
    await fs.mkdir(join(path, ".."), { recursive: true });
    await fs.writeFile(path, text);
  };
  return { base, ports, cleanup, workspace, put, removed };
}

test("recorded workspaces delete generated files, preserve prefix neighbors, and retry idempotently", async (t) => {
  const env = await fixture(t);
  const own = env.workspace();
  const other = env.workspace("1-analysis-a-1-run-more");
  await env.cleanup.register("p", own, "codex_cli");
  await env.cleanup.register("p-more", other, "claude_code");
  await env.put(`${own}/generated/nested/result.bin`);
  await env.put(`${own}/not-in-input-manifest.txt`);
  await env.put(`${other}/keep.txt`, "other project");
  await env.put(
    `${env.ports.rootDir}/sources/shared.json`,
    "shared Zotero source",
  );
  await env.cleanup.confirmStopped("p", own);
  await env.cleanup.quiesce("p");
  assert.deepEqual(await env.cleanup.cleanup("p"), { removedPaths: [own] });
  assert.equal(await env.ports.inspect(own), "missing");
  assert.equal(await env.ports.readText(`${other}/keep.txt`), "other project");
  assert.equal(
    await env.ports.readText(`${env.ports.rootDir}/sources/shared.json`),
    "shared Zotero source",
  );
  assert.equal(await env.ports.inspect(env.cleanup.ledgerPath("p")), "file");
  assert.deepEqual(await env.cleanup.cleanup("p"), { removedPaths: [] });
});

test("registration preserves preexisting directories and concurrent allocations are not lost", async (t) => {
  const env = await fixture(t);
  const existing = env.workspace();
  await env.put(`${existing}/user.txt`, "user file");
  await assert.rejects(
    env.cleanup.register("p", existing, "codex_cli"),
    /already exists/,
  );
  assert.equal(await env.ports.readText(`${existing}/user.txt`), "user file");
  assert.equal(await env.ports.inspect(env.cleanup.ledgerPath("p")), "missing");
  await Promise.all([
    env.cleanup.register("p", env.workspace("2-analysis-first"), "codex_cli"),
    env.cleanup.register(
      "p",
      env.workspace("2-analysis-second"),
      "claude_code",
    ),
  ]);
  const ledgerText = await env.ports.readText(env.cleanup.ledgerPath("p"));
  assert.ok(ledgerText);
  const ledger = JSON.parse(ledgerText);
  assert.equal(ledger.allocations.length, 2);
  assert(
    ledger.allocations.every(
      (entry: { cleanupConfirmed: boolean; launchAttempted: boolean }) =>
        !entry.cleanupConfirmed && !entry.launchAttempted,
    ),
  );
});

test("a possible live process blocks cleanup after restart, even if its directory disappeared", async (t) => {
  const env = await fixture(t);
  const path = env.workspace();
  await env.cleanup.register("p", path, "codex_cli");
  await env.cleanup.markLaunching("p", path);
  const restarted = new ResearchWorkspaceProjectWorkspaceCleanup(env.ports);
  await restarted.quiesce("p");
  await assert.rejects(restarted.cleanup("p"), /stop is not confirmed/);
  await env.put(`${path}/codex-exit.txt`, "file-read-error");
  await assert.rejects(restarted.cleanup("p"), /stop is not confirmed/);
  assert.equal(env.removed.length, 0);
  await env.put(`${path}/codex-exit.txt`, "0\n");
  await restarted.cleanup("p");
  assert.equal(await env.ports.inspect(path), "missing");
});

test("failed stop retains every file and a later deletion retries its owned stop handle", async (t) => {
  const env = await fixture(t);
  const path = env.workspace();
  await env.cleanup.register("p", path, "claude_code");
  await env.cleanup.markLaunching("p", path);
  await env.put(`${path}/output.txt`);
  let attempts = 0;
  env.cleanup.retainStopHandle("p", path, async () => {
    if (++attempts === 1) throw new Error("stop failed");
  });
  await env.cleanup.quiesce("p");
  await assert.rejects(env.cleanup.cleanup("p"), /stop failed/);
  assert.equal(env.removed.length, 0);
  await env.cleanup.cleanup("p");
  assert.equal(attempts, 2);
  assert.equal(await env.ports.inspect(path), "missing");
});

test("no-launch preparation leftovers are safe after the preparation barrier drains", async (t) => {
  const env = await fixture(t);
  const path = env.workspace();
  await env.cleanup.register("p", path, "codex_cli");
  await env.put(`${path}/half-written-prompt.tmp`);
  await env.cleanup.quiesce("p");
  await env.cleanup.cleanup("p");
  assert.equal(await env.ports.inspect(path), "missing");
});

test("quiesce waits for late preparation and blocks allocations after the project task settled", async (t) => {
  const env = await fixture(t);
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await env.cleanup.run("p", async () => {
    env.cleanup.track(
      "p",
      gate.then(() => env.cleanup.register("p", env.workspace(), "codex_cli")),
    );
  });
  let quiesced = false;
  const closing = env.cleanup.quiesce("p").then(() => {
    quiesced = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(quiesced, false);
  resume();
  await closing;
  assert.equal(await env.ports.inspect(env.cleanup.ledgerPath("p")), "missing");
  await assert.rejects(
    env.cleanup.run("p", async () => {}),
    /deletion is in progress/,
  );
  env.cleanup.releaseDeletion("p");
  await env.cleanup.run("p", async () => {});
});

for (const linkLocation of ["workspace", "nested", "ledger"] as const) {
  test(`cleanup refuses a ${linkLocation} symlink and preserves its target`, async (t) => {
    const env = await fixture(t);
    const path = env.workspace();
    await env.cleanup.register("p", path, "codex_cli");
    await env.put(`${env.base}/outside/keep.txt`, "outside user data");
    if (linkLocation === "workspace") {
      await fs.symlink(`${env.base}/outside`, path);
    } else if (linkLocation === "nested") {
      await env.put(`${path}/output.txt`);
      await fs.symlink(`${env.base}/outside`, `${path}/external`);
    } else {
      const ledger = env.cleanup.ledgerPath("p");
      await fs.rename(ledger, `${env.base}/outside/ledger.json`);
      await fs.symlink(`${env.base}/outside/ledger.json`, ledger);
    }
    await env.cleanup.quiesce("p");
    await assert.rejects(env.cleanup.cleanup("p"), /symbolic link/);
    assert.equal(
      await env.ports.readText(`${env.base}/outside/keep.txt`),
      "outside user data",
    );
    assert.equal(env.removed.length, 0);
  });
}

test("a configured root symlink cannot redirect a recorded allocation during deletion", async (t) => {
  const env = await fixture(t);
  await fs.mkdir(`${env.base}/first`);
  await fs.mkdir(`${env.base}/second`);
  await fs.symlink(`${env.base}/first`, `${env.base}/work`);
  const path = env.workspace();
  await env.cleanup.register("p", path, "codex_cli");
  await env.put(`${path}/owned.txt`);
  await fs.unlink(`${env.base}/work`);
  await fs.symlink(`${env.base}/second`, `${env.base}/work`);
  await env.put(`${path}/keep.txt`, "unrelated");
  await env.cleanup.quiesce("p");
  await assert.rejects(env.cleanup.cleanup("p"), /different directory/);
  assert.equal(await env.ports.readText(`${path}/keep.txt`), "unrelated");
  assert.equal(env.removed.length, 0);
});

test("invalid or mismatched ownership ledgers never expand deletion scope", async (t) => {
  const env = await fixture(t);
  const path = env.workspace();
  await env.cleanup.register("p", path, "codex_cli");
  await env.put(`${path}/keep.txt`);
  const ledgerPath = env.cleanup.ledgerPath("p");
  const originalText = await env.ports.readText(ledgerPath);
  assert.ok(originalText);
  const original = JSON.parse(originalText);
  await env.cleanup.quiesce("p");
  for (const value of [
    { ...original, projectID: "other" },
    {
      ...original,
      allocations: [
        {
          ...original.allocations[0],
          workspacePath: `${env.base}/work/../1-analysis-run`,
        },
      ],
    },
    {
      ...original,
      allocations: [
        {
          ...original.allocations[0],
          workspacePath: `${env.base}/work/shared`,
        },
      ],
    },
  ]) {
    await env.ports.writeTextAtomic(ledgerPath, JSON.stringify(value));
    await assert.rejects(env.cleanup.cleanup("p"));
  }
  assert.equal(env.removed.length, 0);
});

test("partial removal failure retains the ledger and retry finishes only remaining files", async (t) => {
  const env = await fixture(t);
  const path = env.workspace();
  await env.cleanup.register("p", path, "codex_cli");
  await env.put(`${path}/a.txt`);
  await env.put(`${path}/b.txt`);
  let failed = false;
  const remove = env.ports.remove;
  env.ports.remove = async (file) => {
    if (!failed && file.endsWith("/b.txt")) {
      failed = true;
      throw new Error("injected removal failure");
    }
    await remove(file);
  };
  await env.cleanup.quiesce("p");
  await assert.rejects(env.cleanup.cleanup("p"), /injected removal failure/);
  assert.equal(await env.ports.inspect(env.cleanup.ledgerPath("p")), "file");
  await env.cleanup.cleanup("p");
  assert.equal(await env.ports.inspect(path), "missing");
});

test("saved PID recovery verifies exact current ownership and accepts escaped workspace paths", async () => {
  const path = "/tmp/O'Brien/1-analysis-test";
  let command = "/usr/bin/unrelated --pid 222";
  let exitStatus: string | undefined = undefined;
  const stopped: string[] = [];
  const ports = {
    read: async (file: string) =>
      file.endsWith("-exit.txt") ? exitStatus : "222",
    command: async () => command,
    stop: async (pid: string) => {
      stopped.push(pid);
    },
  };
  await assert.rejects(
    confirmProjectWorkspaceProcessStopped(path, "codex_cli", ports),
    /no longer identifies/,
  );
  command = `zsh -lc cat ${shellEscape(`${path}-other/prompt.txt`)}`;
  await assert.rejects(
    confirmProjectWorkspaceProcessStopped(path, "codex_cli", ports),
    /no longer identifies/,
  );
  assert.deepEqual(stopped, []);
  command = `zsh -lc cat ${shellEscape(`${path}/prompt.txt`)}`;
  await confirmProjectWorkspaceProcessStopped(path, "codex_cli", ports);
  assert.deepEqual(stopped, ["222"]);
  exitStatus = "0";
  command = "unrelated recycled pid";
  await confirmProjectWorkspaceProcessStopped(path, "codex_cli", ports);
  assert.deepEqual(stopped, ["222"]);
});
