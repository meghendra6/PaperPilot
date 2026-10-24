import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  StudioCompilerService,
  compilerCommand,
  compilerFor,
  type CompilerPorts,
} from "../src/modules/studio/compiler";
import { StudioRepository } from "../src/modules/studio/repository";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";
import { compilerTemplateCache } from "../src/modules/studio/compilerTemplateCache";

const encode = (text: string) => Buffer.from(text).toString("base64");
let fixtureCount = 0;
function fixture() {
  const disk = new Map<string, string>();
  let count = 0;
  let stopped = 0;
  const id = () => `id-${++count}`;
  const files: ResearchWorkspaceFileOps = {
    exists: async (path) => disk.has(path),
    readText: async (path) => disk.get(path),
    writeTextAtomic: async (path, text) => {
      disk.set(path, text);
    },
    ensureDirectory: async () => {},
    listDirectory: async () => [],
    remove: async () => {},
  };
  const repository = new StudioRepository("/owned", files, id);
  const ports: CompilerPorts = {
    scope: `/owned/builds/project-${++fixtureCount}`,
    id,
    prepare: async () => ({ directory: "/job", executable: "/bin/typst" }),
    writeBase64: files.writeTextAtomic,
    readBase64: async (path) => disk.get(path) ?? "",
    write: files.writeTextAtomic,
    read: files.readText,
    log: async (path) => disk.get(path) ?? "",
    launch: async () => {
      disk.set("/job/exit-code", "0");
      disk.set("/job/output/document.pdf", encode("%PDF-1.7\nfixture"));
    },
    stop: async () => {
      stopped++;
    },
    delay: async () => {},
  };
  return {
    disk,
    repository,
    ports,
    stopped: () => stopped,
    service: new StudioCompilerService("project", repository, ports),
  };
}

test("compiler commands preserve path arguments, limit Typst root, and disable Tectonic unsafe features", () => {
  const job = { directory: "/owned job", executable: "/tools/compiler" };
  assert.equal(compilerFor("draft.MYST"), "myst");
  assert.throws(() => compilerFor("draft.docx"));
  assert.throws(() => compilerCommand("typst", job, "../escape.typ"));
  const tex = compilerCommand("tectonic", job, "chapter/--shell-escape.tex");
  assert.ok(tex.command.includes("--untrusted"));
  assert.equal(
    tex.command.at(-1),
    "/owned job/workspace/chapter/--shell-escape.tex",
  );
  const typ = compilerCommand("typst", job, "한글.typ");
  assert.equal(
    typ.command[typ.command.indexOf("--root") + 1],
    "/owned job/workspace",
  );
  const myst = compilerCommand("myst", job, "draft.md");
  assert.ok(!myst.command.includes("--execute"));
  assert.ok(myst.command.includes("--strict"));
});

test("build freezes all saved inputs, preserves sources, and publishes a distinct PDF with provenance", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "chapters/draft.typ",
    encode("first"),
    "You",
  );
  const data = await f.repository.create(
    "project",
    "data/table.csv",
    encode("001,2"),
    "You",
  );
  await f.repository.create(
    "other-project",
    "private.txt",
    encode("private"),
    "You",
  );
  const launch = f.ports.launch;
  f.ports.launch = async (job, command) => {
    await f.repository.save("project", source.id, 1, encode("later"), "You");
    await launch(job, command);
  };
  const result = await f.service.build(source.id, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.source.revision, 1);
  assert.equal(result.inputs.length, 2);
  assert.ok(result.inputs.some((input) => input.id === data.id));
  assert.equal(
    f.disk.get("/job/workspace/chapters/draft.typ"),
    encode("first"),
  );
  assert.equal(f.disk.get("/job/workspace/data/table.csv"), encode("001,2"));
  assert.ok(!f.disk.has("/job/workspace/private.txt"));
  assert.equal(
    (await f.repository.read("project", source.id)).base64,
    encode("later"),
  );
  assert.match(result.output!.name, /^exports\/draft-r1-.*\.pdf$/);
  assert.equal(
    JSON.parse(f.disk.get("/job/result.json")!).output.id,
    result.output!.id,
  );
  await assert.rejects(f.service.build(source.id, 1), /source changed/);
});

test("failed and canceled builds retain diagnostics without adding a PDF, and stop running jobs", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.typ",
    encode("broken"),
    "You",
  );
  f.ports.launch = async () => {
    f.disk.set("/job/exit-code", "1");
    f.disk.set("/job/stderr.txt", "draft.typ:1: unknown symbol");
  };
  const failed = await f.service.build(source.id, 1);
  assert.equal(failed.status, "failed");
  assert.match(failed.log, /unknown symbol/);
  assert.equal((await f.repository.list("project")).documents.length, 1);
  f.disk.delete("/job/exit-code");
  f.ports.launch = async () => {};
  f.ports.delay = async () => {
    await assert.rejects(f.service.build(source.id, 1), /already running/);
    f.service.cancel();
  };
  const canceled = await f.service.build(source.id, 1);
  assert.equal(canceled.status, "canceled");
  assert.equal(f.stopped(), 1);
  assert.equal((await f.repository.list("project")).documents.length, 1);
});

test("build reads frozen byte versions after rename and archive metadata changes", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.typ",
    encode("original source"),
    "You",
  );
  const data = await f.repository.create(
    "project",
    "data.csv",
    encode("value\n21"),
    "You",
  );
  const renamed = await f.repository.rename(
    "project",
    source.id,
    source.revision,
    "chapters/manuscript.typ",
  );
  const archived = await f.repository.archive(
    "project",
    data.id,
    data.revision,
    true,
  );
  await f.repository.archive("project", data.id, archived.revision, false);
  assert.equal(renamed.revision, 2);
  assert.equal(renamed.versions.at(-1)!.revision, 1);
  const result = await f.service.build(source.id, renamed.revision);
  assert.equal(result.status, "complete");
  assert.equal(result.source.revision, 2);
  assert.equal(
    f.disk.get("/job/workspace/chapters/manuscript.typ"),
    encode("original source"),
  );
  assert.equal(f.disk.get("/job/workspace/data.csv"), encode("value\n21"));
  assert.deepEqual(
    result.inputs.map((input) => input.revision),
    [1, 1],
  );
  await assert.rejects(f.service.build(source.id, 1), /source changed/);
});

test("a failed launch acknowledgment still stops a potentially started compiler", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.typ",
    encode("hello"),
    "You",
  );
  f.ports.launch = async () => {
    throw new Error("The child started but launch acknowledgment failed.");
  };
  const result = await f.service.build(source.id, source.revision);
  assert.equal(result.status, "failed");
  assert.match(result.log, /launch acknowledgment failed/);
  assert.equal(f.stopped(), 1);
  assert.equal((await f.repository.list("project")).documents.length, 1);
});

test("unconfirmed compiler cleanup survives a replacement service and retries before launch", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.typ",
    encode("hello"),
    "You",
  );
  const launch = f.ports.launch;
  let launches = 0;
  let cleanupFails = true;
  f.ports.launch = async () => {
    launches++;
    throw new Error("launch acknowledgement failed");
  };
  f.ports.stop = async () => {
    if (cleanupFails) throw new Error("termination unconfirmed");
  };
  const failed = await f.service.build(source.id, 1);
  assert.match(failed.log, /termination unconfirmed/);
  await assert.rejects(f.service.build(source.id, 1), /cleanup.*unconfirmed/i);
  const replacement = new StudioCompilerService("project", f.repository, {
    ...f.ports,
  });
  await assert.rejects(
    replacement.build(source.id, 1),
    /cleanup.*unconfirmed/i,
  );
  assert.equal(launches, 1);
  cleanupFails = false;
  const recovered = new StudioCompilerService("project", f.repository, {
    ...f.ports,
    launch,
  });
  assert.equal((await recovered.build(source.id, 1)).status, "complete");
});

test("a replacement compiler waits for cancellation cleanup and ignores the old service cancel", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.typ",
    encode("hello"),
    "You",
  );
  let releaseStop!: () => void;
  let stopping!: () => void;
  const stopStarted = new Promise<void>((resolve) => (stopping = resolve));
  const stopped = new Promise<void>((resolve) => (releaseStop = resolve));
  const successfulLaunch = f.ports.launch;
  f.ports.launch = async () => f.service.cancel();
  f.ports.stop = async () => {
    stopping();
    await stopped;
  };
  const first = f.service.build(source.id, 1);
  await stopStarted;
  const replacementPorts = { ...f.ports, launch: successfulLaunch };
  const replacement = new StudioCompilerService(
    "project",
    f.repository,
    replacementPorts,
  );
  try {
    await assert.rejects(replacement.build(source.id, 1), /already running/);
  } finally {
    releaseStop();
    assert.equal((await first).status, "canceled");
  }
  let releaseLaunch!: () => void;
  let launching!: () => void;
  const launchStarted = new Promise<void>((resolve) => (launching = resolve));
  const launched = new Promise<void>((resolve) => (releaseLaunch = resolve));
  replacementPorts.launch = async (job, command) => {
    launching();
    await launched;
    await successfulLaunch(job, command);
  };
  const next = replacement.build(source.id, 1);
  await launchStarted;
  f.service.cancel();
  releaseLaunch();
  assert.equal((await next).status, "complete");
});

test("pending compiler cleanup admits one replacement and keeps profiles isolated", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.typ",
    encode("hello"),
    "You",
  );
  const successfulLaunch = f.ports.launch;
  f.ports.launch = async () => {
    throw new Error("launch acknowledgement failed");
  };
  f.ports.stop = async () => {
    throw new Error("termination unconfirmed");
  };
  assert.equal((await f.service.build(source.id, 1)).status, "failed");
  let releaseStop!: () => void;
  let stopping!: () => void;
  const stopStarted = new Promise<void>((resolve) => (stopping = resolve));
  const stopped = new Promise<void>((resolve) => (releaseStop = resolve));
  let cleanupCalls = 0;
  const ports = {
    ...f.ports,
    launch: successfulLaunch,
    stop: async () => {
      cleanupCalls++;
      stopping();
      await stopped;
    },
  };
  const replacement = new StudioCompilerService("project", f.repository, ports);
  const pending = replacement.build(source.id, 1);
  await stopStarted;
  try {
    const concurrent = new StudioCompilerService("project", f.repository, {
      ...ports,
    });
    await assert.rejects(concurrent.build(source.id, 1), /already running/);
    assert.equal(cleanupCalls, 1);
    const other = fixture();
    const separateSource = await other.repository.create(
      "project",
      "draft.typ",
      encode("independent"),
      "You",
    );
    assert.equal(
      (await other.service.build(separateSource.id, 1)).status,
      "complete",
    );
  } finally {
    releaseStop();
    assert.equal((await pending).status, "complete");
  }
});

test("snapshot path collisions reject before preparing or launching a compiler", async () => {
  for (const names of [
    ["Data.csv", "data.csv"],
    ["data", "data/table.csv"],
  ]) {
    const f = fixture();
    const source = await f.repository.create(
      "project",
      "draft.typ",
      encode("hello"),
      "You",
    );
    for (const name of names)
      await f.repository.create("project", name, encode("input"), "You");
    f.ports.prepare = async () => {
      assert.fail("A colliding snapshot must not prepare a build directory.");
    };
    f.ports.launch = async () => {
      assert.fail("A colliding snapshot must not launch a compiler.");
    };
    await assert.rejects(f.service.build(source.id, 1), /paths conflict/i);
    assert.equal(f.stopped(), 0);
    assert.ok(![...f.disk.keys()].some((path) => path.startsWith("/job/")));
  }
});

test("MyST generated configuration cannot overwrite a differently cased project file", async () => {
  const f = fixture();
  const source = await f.repository.create(
    "project",
    "draft.md",
    encode("# Draft"),
    "You",
  );
  const config = await f.repository.create(
    "project",
    "MYST.yml",
    encode("version: 1\nproject:\n  title: Keep me\n"),
    "You",
  );
  f.ports.prepare = async () => {
    assert.fail("Reject a generated-config collision before preparing.");
  };
  await assert.rejects(f.service.build(source.id, 1), /paths conflict/i);
  assert.equal(
    (await f.repository.read("project", config.id)).base64,
    encode("version: 1\nproject:\n  title: Keep me\n"),
  );
});

test("MyST reuses project templates only after successful PDF publication", async () => {
  const f = fixture();
  const steps: string[] = [];
  f.ports.templates = {
    restore: async () => {
      steps.push("restore");
    },
    retain: async () => {
      assert.equal((await f.repository.list("project")).documents.length, 2);
      steps.push("retain");
    },
  };
  const source = await f.repository.create(
    "project",
    "draft.md",
    encode("# Title"),
    "You",
  );
  assert.equal((await f.service.build(source.id, 1)).status, "complete");
  assert.deepEqual(steps, ["restore", "retain"]);
  steps.length = 0;
  f.ports.launch = async () => {
    f.disk.set("/job/exit-code", "1");
  };
  assert.equal((await f.service.build(source.id, 1)).status, "failed");
  assert.deepEqual(steps, ["restore"]);
});

test("template cache copies only an owned build's templates and rejects foreign paths", async () => {
  const disk = new Map<string, string>();
  const existing = new Set<string>();
  const copied: string[][] = [];
  const files: ResearchWorkspaceFileOps = {
    exists: async (path) => disk.has(path) || existing.has(path),
    readText: async (path) => {
      assert.ok(disk.has(path));
      return disk.get(path);
    },
    writeTextAtomic: async (path, text) => {
      disk.set(path, text);
    },
    ensureDirectory: async () => {},
    listDirectory: async () => [],
    remove: async () => {},
  };
  const cache = compilerTemplateCache(
    "/project/builds",
    files,
    async (...paths) => {
      copied.push(paths);
    },
  );
  const first = { directory: "/project/builds/first", executable: "myst" };
  const second = { directory: "/project/builds/second", executable: "myst" };
  await cache.restore(first);
  await cache.retain(first);
  assert.equal(disk.size, 0);
  existing.add("/project/builds/first/workspace/_build/templates");
  await cache.retain(first);
  await cache.restore(second);
  assert.deepEqual(copied, [
    [
      "/project/builds/first/workspace/_build/templates",
      "/project/builds/second/workspace/_build/templates",
    ],
  ]);
  disk.set("/project/builds/myst-template-cache.txt", "../other");
  await assert.rejects(cache.restore(second), /Invalid MyST/);
  await assert.rejects(
    cache.retain({ ...first, directory: "/other/builds/first" }),
    /does not belong/,
  );
});
