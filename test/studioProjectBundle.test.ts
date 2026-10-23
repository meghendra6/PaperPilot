import { strict as assert } from "node:assert";
import { test } from "node:test";
import { StudioRepository } from "../src/modules/studio/repository";
import { StudioAIService } from "../src/modules/studio/aiService";
import {
  parseProjectBundle,
  projectBundle,
  assertProjectSnapshotRevision,
} from "../src/modules/studio/projectBundle";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";

const encode = (text: string) => Buffer.from(text).toString("base64");

test("bundle capture rejects document mutations between file and conversation snapshots", async () => {
  const { repository } = fixture();
  const empty = JSON.parse(await repository.exportDocuments("project", true));
  assert.doesNotThrow(() => assertProjectSnapshotRevision(empty, 0));
  await repository.create("project", "draft.md", encode("draft"), "You");
  const captured = JSON.parse(
    await repository.exportDocuments("project", true),
  );
  assert.doesNotThrow(() =>
    assertProjectSnapshotRevision(captured, captured.manifest.revision),
  );
  assert.throws(
    () =>
      assertProjectSnapshotRevision(captured, captured.manifest.revision + 1),
    /changed/,
  );
  assert.throws(() => assertProjectSnapshotRevision(captured, 0), /changed/);
});
function fixture() {
  const disk = new Map<string, string>();
  let count = 0;
  let fail = false;
  const files: ResearchWorkspaceFileOps = {
    exists: async (path) =>
      disk.has(path) ||
      [...disk.keys()].some((key) => key.startsWith(`${path}/`)),
    readText: async (path) => disk.get(path),
    writeTextAtomic: async (path, text) => {
      if (fail && path.endsWith("manifest-v1.json"))
        throw new Error("disk full");
      disk.set(path, text);
    },
    ensureDirectory: async () => {},
    listDirectory: async (path) =>
      [...disk.keys()].filter((key) => key.startsWith(`${path}/`)),
    remove: async (path) => {
      disk.delete(path);
    },
  };
  const id = () => `id-${++count}`,
    repository = new StudioRepository("/root", files, id);
  const service = (projectID: string) =>
    new StudioAIService(projectID, repository, {
      files,
      root: "/root",
      id,
      encode,
      text: (_name, base64) => Buffer.from(base64, "base64").toString(),
      run: async () =>
        JSON.stringify({ reply: "Recorded answer", changes: [] }),
    });
  return {
    disk,
    repository,
    service,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
const config = {
  provider: "local" as const,
  endpoint: "http://127.0.0.1:11434/v1",
  model: "test",
  apiKey: "secret-never-export",
};

test("project bundle preserves document history, active/archive conversations and historical evidence atomically", async () => {
  const f = fixture(),
    source = f.service("source");
  const doc = await f.repository.create(
    "source",
    "draft.md",
    encode("Original"),
    "You",
  );
  await source.ask(config, "First question", [doc.id]);
  await source.newConversation();
  await f.repository.save("source", doc.id, 1, encode("Updated"), "You");
  await source.ask(config, "Current question", [doc.id]);
  const context = await source.exportProjectContext("한글 project", {
    project: { projectID: "source" },
    sources: [{ sourceID: "old-library:old-key", evidence: "historical" }],
  });
  const text = projectBundle(
    JSON.parse(await f.repository.exportDocuments("source")),
    context,
  );
  assert(!text.includes(config.apiKey));
  f.fail(true);
  await assert.rejects(
    f.service("destination").restoreProjectBundle(text),
    /disk full/,
  );
  assert.equal((await f.repository.list("destination")).documents.length, 0);
  assert.equal((await f.service("destination").history()).turns.length, 0);
  f.fail(false);
  const destination = f.service("destination");
  await destination.restoreProjectBundle(text);
  assert.equal(
    (await f.repository.read("destination", doc.id, 1)).base64,
    encode("Original"),
  );
  assert.equal(
    (await f.repository.read("destination", doc.id)).base64,
    encode("Updated"),
  );
  assert.equal((await destination.history()).projectID, "destination");
  assert.equal(
    (await destination.history()).turns[0].question,
    "Current question",
  );
  const archives = await destination.conversations();
  assert.equal(archives.length, 1);
  assert.equal(
    (await destination.resumeConversation(archives[0].id)).turns[0].question,
    "First question",
  );
  assert.equal((await destination.conversations()).length, 2);
  const imported = await f.repository.importedContext("destination");
  assert.equal(imported?.sourceProjectID, "source");
  assert.equal(imported?.projectName, "한글 project");
  assert(!f.disk.has("/root/sources/old-library:old-key.json"));
  const pointer = (await f.repository.list("destination")).importedContext!;
  await f.repository.save(
    "destination",
    pointer.documentID,
    1,
    encode("User edits do not rewrite imported history"),
    "You",
  );
  assert.equal(
    (await f.repository.importedContext("destination"))?.sourceProjectID,
    "source",
  );
  await assert.rejects(destination.restoreProjectBundle(text), /new project/);
});

test("project bundle rejects malformed history/checksums before publishing destination bytes", async () => {
  const f = fixture(),
    service = f.service("source");
  const doc = await f.repository.create(
    "source",
    "draft.md",
    encode("Original"),
    "You",
  );
  await service.ask(config, "Question", [doc.id]);
  const context = await service.exportProjectContext("Project", {});
  const text = projectBundle(
    JSON.parse(await f.repository.exportDocuments("source")),
    context,
  );
  const broken = JSON.parse(text);
  broken.context.currentConversation.turns[0].context[0].id = "../host";
  const size = f.disk.size;
  await assert.rejects(
    f.service("destination").restoreProjectBundle(JSON.stringify(broken)),
    /identifier/,
  );
  assert.equal(f.disk.size, size);
  const badHash = JSON.parse(text);
  badHash.documents.blobs[doc.versions[0].blobID] = encode("Tampered");
  await assert.rejects(
    f.service("destination").restoreProjectBundle(JSON.stringify(badHash)),
    /checksum/,
  );
  assert.equal(f.disk.size, size);
  const extra = JSON.parse(text);
  extra.context.currentConversation.turns[0].apiKey = "unknown-secret";
  assert(
    !JSON.stringify(parseProjectBundle(JSON.stringify(extra))).includes(
      "unknown-secret",
    ),
  );
});

test("research-only project bundles restore without requiring an existing document", async () => {
  const f = fixture(),
    service = f.service("source");
  const context = await service.exportProjectContext("Research only", {
    artifacts: [{ title: "Evidence snapshot" }],
  });
  const text = projectBundle(
    JSON.parse(await f.repository.exportDocuments("source", true)),
    context,
  );
  await f.service("destination").restoreProjectBundle(text);
  assert.equal((await f.repository.list("destination")).documents.length, 1);
  assert.equal((await f.service("destination").history()).turns.length, 0);
});
