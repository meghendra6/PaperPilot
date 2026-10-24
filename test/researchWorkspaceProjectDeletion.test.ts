import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ResearchWorkspaceProjectRepository } from "../src/modules/researchWorkspace/persistence/projectRepository";
import { SerializedResearchWorkspaceFiles } from "../src/modules/researchWorkspace/persistence/fileStore";
import { getResearchWorkspaceProjectOwnedDirectories } from "../src/modules/researchWorkspace/persistence/projectDeletionPaths";
import { assertSafeProjectRemoval } from "../src/modules/researchWorkspace/persistence/removalSafety";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "paperpilot-delete-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const removals: string[] = [];
  const controls: { failRemove?: string; failCatalog?: boolean } = {};
  const inspect = async (entry: string) => {
    try {
      const stat = await fs.lstat(entry);
      return stat.isSymbolicLink()
        ? ("symlink" as const)
        : stat.isDirectory()
          ? ("directory" as const)
          : ("file" as const);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return "missing" as const;
      throw error;
    }
  };
  const children = async (directory: string) =>
    (await fs.readdir(directory)).map((name) => path.join(directory, name));
  const ops: ResearchWorkspaceFileOps = {
    async ensureDirectory(entry) {
      await fs.mkdir(entry, { recursive: true });
    },
    async exists(entry) {
      return (await inspect(entry)) !== "missing";
    },
    async readText(entry) {
      try {
        return await fs.readFile(entry, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    },
    async writeTextAtomic(entry, contents) {
      if (controls.failCatalog && entry.endsWith("catalog-v1.json"))
        throw new Error("catalog write failed");
      await fs.mkdir(path.dirname(entry), { recursive: true });
      await fs.writeFile(entry, contents);
    },
    async remove(entry, options) {
      if (entry === controls.failRemove) throw new Error("remove failed");
      removals.push(entry);
      await fs.rm(entry, {
        recursive: options?.recursive ?? false,
        force: true,
      });
    },
    async listDirectory(entry) {
      if ((await inspect(entry)) === "missing") return [];
      const result: string[] = [];
      const walk = async (dir: string) => {
        for (const child of await children(dir)) {
          result.push(child);
          if ((await inspect(child)) === "directory") await walk(child);
        }
      };
      await walk(entry);
      return result;
    },
    assertSafeRemoval: (entry, storageRoot) =>
      assertSafeProjectRemoval(entry, storageRoot, { inspect, children }),
  };
  const createRepository = () =>
    new ResearchWorkspaceProjectRepository({ rootDir: root, fileOps: ops });
  const repository = createRepository();
  await repository.createProject({ projectID: "owned", name: "Same name" });
  return { root, repository, createRepository, ops, controls, removals };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("project deletion removes every managed root and retains other projects and shared sources", async (t) => {
  const f = await fixture(t);
  await f.repository.createProject({
    projectID: "owned-neighbor",
    name: "Same name",
  });
  const roots = getResearchWorkspaceProjectOwnedDirectories(f.root, "owned");
  for (const root of roots)
    await f.ops.writeTextAtomic(
      path.join(root, "nested", "generated.tmp"),
      "owned",
    );
  const source = path.join(f.root, "sources", "shared.json");
  await f.ops.writeTextAtomic(source, "shared");
  let cleanup = 0;
  await f.repository.deleteProject("owned", async () => {
    cleanup++;
    assert.equal(
      await f.ops.exists(f.repository.getProjectPath("owned")),
      true,
    );
    assert.equal(
      await f.ops.exists(path.join(f.root, "deletions", "project-owned.json")),
      true,
    );
  });
  assert.equal(cleanup, 1);
  for (const root of roots) assert.equal(await f.ops.exists(root), false, root);
  assert.equal(await f.ops.readText(source), "shared");
  assert.equal(
    (await f.repository.getProject("owned-neighbor")).project.name,
    "Same name",
  );
  assert.deepEqual(
    (await f.repository.listProjects()).map((entry) => entry.projectID),
    ["owned-neighbor"],
  );
  assert.equal(f.removals.at(-2), f.repository.getProjectRoot("owned"));
  await f.repository.deleteProject("owned");
  await f.repository.createProject({
    projectID: "owned",
    name: "Recreated quick project",
  });
  assert.equal(
    (await f.repository.getProject("owned")).project.name,
    "Recreated quick project",
  );
});

test("partial deletion is blocked for edits and remains retryable after repository restart", async (t) => {
  const f = await fixture(t);
  const roots = getResearchWorkspaceProjectOwnedDirectories(f.root, "owned");
  for (const root of roots)
    await f.ops.writeTextAtomic(path.join(root, "job.tmp"), "owned");
  f.controls.failRemove = roots[2];
  await assert.rejects(f.repository.deleteProject("owned"), /remove failed/);
  assert.equal(await f.ops.exists(f.repository.getProjectPath("owned")), true);
  await assert.rejects(
    f.repository.getProject("owned"),
    /deletion is incomplete/,
  );
  await assert.rejects(
    f.repository.updateProject("owned", 1, (project) => ({
      ...project,
      name: "late",
    })),
    /deletion is in progress/,
  );
  const restarted = f.createRepository();
  const repaired = await restarted.repairCatalog();
  assert.equal(repaired.catalog.projects[0].projectID, "owned");
  assert.match(repaired.warnings.join("\n"), /unfinished cleanup/);
  f.controls.failRemove = undefined;
  await restarted.deleteProject("owned");
  for (const root of roots) assert.equal(await f.ops.exists(root), false);
});

test("failed catalog commit retains deletion receipt and can finish without project.json", async (t) => {
  const f = await fixture(t);
  f.controls.failCatalog = true;
  await assert.rejects(
    f.repository.deleteProject("owned"),
    /catalog write failed/,
  );
  assert.equal(await f.ops.exists(f.repository.getProjectPath("owned")), false);
  f.controls.failCatalog = false;
  const restarted = f.createRepository();
  assert.equal(
    (await restarted.repairCatalog()).catalog.projects[0].projectID,
    "owned",
  );
  await restarted.deleteProject("owned");
  assert.deepEqual(await restarted.listProjects(), []);
  assert.equal(
    await f.ops.exists(path.join(f.root, "deletions", "project-owned.json")),
    false,
  );
});

test("symlink preflight refuses the whole deletion before removing any file", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "sources");
  await f.ops.writeTextAtomic(path.join(target, "keep.txt"), "keep");
  await fs.symlink(
    target,
    path.join(f.repository.getProjectRoot("owned"), "linked"),
  );
  await assert.rejects(f.repository.deleteProject("owned"), /symbolic link/);
  assert.deepEqual(f.removals, []);
  assert.equal(await f.ops.readText(path.join(target, "keep.txt")), "keep");
  assert.equal(
    (await f.repository.getProject("owned")).project.name,
    "Same name",
  );
});

test("reserved and unknown IDs cannot authorize deleting shared runtime trees", async (t) => {
  const f = await fixture(t);
  const unrelated = path.join(f.root, "runtime", "unknown", "keep");
  await f.ops.writeTextAtomic(unrelated, "keep");
  await assert.rejects(
    f.repository.deleteProject("builds"),
    /shared runtime directory/,
  );
  await assert.rejects(
    f.repository.deleteProject("../owned"),
    /unsupported path/,
  );
  await f.repository.deleteProject("unknown");
  assert.deepEqual(f.removals, []);
  assert.equal(await f.ops.readText(unrelated), "keep");
});

test("duplicate delete requests share cleanup and cleanup failure preserves project data", async (t) => {
  const f = await fixture(t);
  const started = deferred();
  const finish = deferred();
  let calls = 0;
  const one = f.repository.deleteProject("owned", async () => {
    calls++;
    started.resolve();
    await finish.promise;
    throw new Error("stop unconfirmed");
  });
  await started.promise;
  const two = f.repository.deleteProject("owned", async () => {
    calls++;
  });
  assert.equal(one, two);
  finish.resolve();
  await assert.rejects(one, /stop unconfirmed/);
  assert.equal(calls, 1);
  assert.deepEqual(f.removals, []);
  assert.equal(await f.ops.exists(f.repository.getProjectPath("owned")), true);
  await f.repository.deleteProject("owned");
});

test("directory freeze drains an admitted write and prevents queued or late writes from recreating files", async (t) => {
  const f = await fixture(t);
  const entered = deferred();
  const finish = deferred();
  const directory = path.join(f.root, "runtime", "owned");
  const file = path.join(directory, "state.json");
  const store = new SerializedResearchWorkspaceFiles({
    ...f.ops,
    async writeTextAtomic(entry, contents) {
      entered.resolve();
      await finish.promise;
      await f.ops.writeTextAtomic(entry, contents);
    },
  });
  const first = store.writeNew(file, { revision: 0 });
  await entered.promise;
  const queued = assert.rejects(
    store.replace(file, { revision: 2 }),
    /deletion is in progress/,
  );
  let drained = false;
  const frozen = store.freezeDirectories([directory]).then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  await assert.rejects(
    store.ensureDirectory(path.join(directory, "late")),
    /deletion is in progress/,
  );
  finish.resolve();
  await Promise.all([first, queued, frozen]);
  await store.removeFrozenDirectory(directory);
  await assert.rejects(
    store.writeNew(file, { revision: 0 }),
    /deletion is in progress/,
  );
  assert.equal(await f.ops.exists(directory), false);
});
