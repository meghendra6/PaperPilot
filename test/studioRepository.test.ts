import { strict as assert } from "node:assert";
import { test } from "node:test";
import { StudioRepository } from "../src/modules/studio/repository";
import {
  StudioRevisionConflict,
  documentByteLength,
  parseStudioManifest,
} from "../src/modules/studio/contracts";
import type { ResearchWorkspaceFileOps } from "../src/modules/researchWorkspace/persistence/contracts";
import type { OutputOrigin } from "../src/modules/studio/outputProvenance";

function fixture() {
  const disk = new Map<string, string>();
  let count = 0;
  let failManifest = false;
  const files: ResearchWorkspaceFileOps = {
    exists: async (path) => disk.has(path),
    readText: async (path) => disk.get(path),
    writeTextAtomic: async (path, value) => {
      if (failManifest && path.endsWith("manifest-v1.json"))
        throw new Error("disk full");
      disk.set(path, value);
    },
    ensureDirectory: async () => {},
    listDirectory: async (path) =>
      [...disk.keys()].filter((key) => key.startsWith(path)),
    remove: async (path) => {
      disk.delete(path);
    },
  };
  const repository = new StudioRepository(
    "/owned",
    files,
    () => `id-${++count}`,
    () => "2026-10-22T00:00:00.000Z",
  );
  return {
    repository,
    disk,
    files,
    fail: () => {
      failManifest = true;
    },
    recover: () => {
      failManifest = false;
    },
  };
}

const encode = (value: string) => Buffer.from(value).toString("base64");

test("draft insertion receipts commit with bytes and survive edits, restore and bundle migration", async () => {
  const { repository, fail, recover } = fixture();
  const image = await repository.create(
    "project",
    "figure.png",
    encode("image"),
    "You",
  );
  const draft = await repository.create(
    "project",
    "paper.docx",
    encode("draft"),
    "You",
  );
  const insertion = {
    id: "insertion",
    assetID: image.id,
    assetRevision: 1,
    insertedAt: "2026-10-23T00:00:00Z",
  };
  fail();
  await assert.rejects(
    repository.save(
      "project",
      draft.id,
      1,
      encode("with image"),
      "You",
      "edit",
      [insertion],
    ),
    /disk full/,
  );
  recover();
  assert.equal(
    (await repository.read("project", draft.id)).version.insertions,
    undefined,
  );
  await repository.save(
    "project",
    draft.id,
    1,
    encode("with image"),
    "You",
    "edit",
    [insertion],
  );
  await repository.save("project", draft.id, 2, encode("manual edit"), "You");
  assert.deepEqual(
    (await repository.read("project", draft.id)).version.insertions,
    [insertion],
  );
  await repository.restoreDocuments(
    "copy",
    await repository.exportDocuments("project"),
  );
  assert.deepEqual(
    (await repository.read("copy", draft.id)).version.insertions,
    [insertion],
  );
  await repository.restore("project", draft.id, 3, 1, "You");
  assert.equal(
    (await repository.read("project", draft.id)).version.insertions,
    undefined,
  );
  await assert.rejects(
    repository.save("project", draft.id, 4, encode("invalid"), "You", "edit", [
      { ...insertion, assetRevision: 200 },
    ]),
    /unavailable/,
  );
  assert.equal(
    (await repository.read("project", draft.id)).document.revision,
    4,
  );
});

test("rename atomically updates linked drafts and preserves prior bytes and graph identities", async () => {
  const { repository, fail, recover } = fixture();
  const image = await repository.create(
    "project",
    "figures/plot.png",
    encode("image"),
    "You",
  );
  const draft = await repository.create(
    "project",
    "paper.md",
    encode("![plot](figures/plot.png)"),
    "You",
  );
  fail();
  await assert.rejects(
    repository.rename("project", image.id, 1, "new.png"),
    /disk full/,
  );
  recover();
  assert.equal(
    (await repository.read("project", image.id)).document.name,
    "figures/plot.png",
  );
  assert.equal(
    (await repository.read("project", draft.id)).document.revision,
    1,
  );
  await repository.rename("project", image.id, 1, "new.png");
  const changed = await repository.read("project", draft.id);
  assert.equal(changed.document.revision, 2);
  assert.equal(changed.base64, encode("![plot](new.png)"));
  assert.equal(
    (await repository.read("project", draft.id, 1)).base64,
    encode("![plot](figures/plot.png)"),
  );
  const graph = await repository.links("project");
  assert.equal(graph.edges[0].from, draft.id);
  assert.equal(graph.edges[0].to, image.id);
  await assert.rejects(
    repository.rename("project", image.id, 2, "new.docx"),
    /extension/,
  );
});

test("output execution provenance survives rename, historical restore and project migration", async () => {
  const { repository } = fixture();
  const origin: OutputOrigin = {
    execution: {
      schemaVersion: 1,
      id: "run",
      sessionID: "session",
      notebookID: "notebook",
      kernel: "python3",
      code: "plot(data)",
      startedAt: "2026-10-23T00:00:00Z",
      completedAt: "2026-10-23T00:00:01Z",
      inputs: [],
    },
    cellID: "cell",
    outputIndex: 0,
    outputHash: "a".repeat(64),
  };
  const doc = await repository.create(
    "project",
    "figure.png",
    encode("image"),
    "You",
    origin,
  );
  await repository.rename("project", doc.id, 1, "figures/renamed.png");
  await repository.save("project", doc.id, 2, encode("edited image"), "You");
  assert.equal(
    (await repository.read("project", doc.id)).version.origin,
    undefined,
  );
  await repository.restore("project", doc.id, 3, 1, "You");
  assert.deepEqual(
    (await repository.read("project", doc.id)).version.origin,
    origin,
  );
  await repository.restoreDocuments(
    "copy",
    await repository.exportDocuments("project"),
  );
  assert.deepEqual(
    (await repository.read("copy", doc.id)).version.origin,
    origin,
  );
});

test("document backup restores original bytes, all versions, archive state and stable cross-document identities", async () => {
  const f = fixture();
  const doc = await f.repository.create(
    "original",
    "한글/draft.docx",
    encode("original bytes"),
    "Author",
  );
  await f.repository.save(
    "original",
    doc.id,
    1,
    encode("edited bytes"),
    "Editor",
  );
  await f.repository.archive("original", doc.id, 2, true);
  const backup = await f.repository.exportDocuments("original");
  const restored = await f.repository.restoreDocuments("destination", backup);
  assert.equal(restored.projectID, "destination");
  assert.equal(restored.documents[0].id, doc.id);
  assert.equal(restored.documents[0].archived, true);
  assert.equal(restored.documents[0].versions[0].author, "Author");
  assert.notEqual(
    restored.documents[0].versions[0].blobID,
    doc.versions[0].blobID,
  );
  assert.equal(
    (await f.repository.read("destination", doc.id, 1)).base64,
    encode("original bytes"),
  );
  assert.equal(
    (await f.repository.read("destination", doc.id)).base64,
    encode("edited bytes"),
  );
  await assert.rejects(
    f.repository.restoreDocuments("destination", backup),
    /no documents/,
  );
});

test("backup validation and failed publication cannot replace destination data", async () => {
  const f = fixture();
  await f.repository.create("original", "draft.md", encode("first"), "You");
  const backup = await f.repository.exportDocuments("original");
  const damaged = JSON.parse(backup);
  damaged.blobs[damaged.manifest.documents[0].versions[0].blobID] =
    encode("other");
  await assert.rejects(
    f.repository.restoreDocuments("destination", JSON.stringify(damaged)),
    /checksum/,
  );
  assert.equal((await f.repository.list("destination")).documents.length, 0);
  const hostile = JSON.parse(backup);
  hostile.manifest.documents[0].name = "../outside.md";
  await assert.rejects(
    f.repository.restoreDocuments("destination", JSON.stringify(hostile)),
    /relative/,
  );
  f.fail();
  await assert.rejects(
    f.repository.restoreDocuments("destination", backup),
    /disk full/,
  );
  f.recover();
  assert.equal((await f.repository.list("destination")).documents.length, 0);
  assert.equal(
    (await f.repository.restoreDocuments("destination", backup)).documents
      .length,
    1,
  );
});

test("same-length byte corruption is detected without rewriting saved history", async () => {
  const { repository, disk } = fixture();
  const doc = await repository.create(
    "project",
    "draft.txt",
    encode("first"),
    "You",
  );
  assert.match(doc.versions[0].sha256!, /^[a-f0-9]{64}$/);
  const path = `/owned/projects/project-project/documents/blobs/${doc.versions[0].blobID}.json`;
  const corrupted = JSON.stringify({
    schemaVersion: 1,
    base64: encode("other"),
  });
  disk.set(path, corrupted);
  await assert.rejects(repository.read("project", doc.id), /damaged/);
  assert.equal(disk.get(path), corrupted);
});

test("documents preserve original bytes, Unicode names, and project isolation", async () => {
  const { repository } = fixture();
  const bytes = Buffer.from([0, 1, 255, 80, 75]).toString("base64");
  const doc = await repository.create(
    "project-1",
    "원고/초안.docx",
    bytes,
    "Reader",
  );
  assert.equal((await repository.read("project-1", doc.id)).base64, bytes);
  assert.equal(
    (await repository.list("project-1")).documents[0].name,
    "원고/초안.docx",
  );
  assert.deepEqual((await repository.list("project-2")).documents, []);
  await assert.rejects(repository.read("project-2", doc.id), /not found/);
});

test("concurrent saves admit one current revision and retain the losing caller's bytes outside storage", async () => {
  const { repository } = fixture();
  const doc = await repository.create("p", "draft.md", encode("original"), "A");
  const results = await Promise.allSettled([
    repository.save("p", doc.id, 1, encode("first"), "A"),
    repository.save("p", doc.id, 1, encode("second"), "B"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const failure = results.find(
    (result) => result.status === "rejected",
  ) as PromiseRejectedResult;
  assert.ok(failure.reason instanceof StudioRevisionConflict);
  assert.equal((await repository.read("p", doc.id)).base64, encode("first"));
  assert.equal(
    (await repository.read("p", doc.id, 1)).base64,
    encode("original"),
  );
});

test("a failed manifest commit leaves the old version readable and permits a later retry", async () => {
  const f = fixture();
  const doc = await f.repository.create(
    "p",
    "draft.docx",
    encode("original"),
    "A",
  );
  f.fail();
  await assert.rejects(
    f.repository.save("p", doc.id, 1, encode("new"), "A"),
    /disk full/,
  );
  assert.equal(
    (await f.repository.read("p", doc.id)).base64,
    encode("original"),
  );
  assert.equal((await f.repository.list("p")).documents[0].revision, 1);
  f.recover();
  const updated = await f.repository.save("p", doc.id, 1, encode("retry"), "A");
  assert.equal(updated.revision, 2);
  assert.equal((await f.repository.read("p", doc.id)).base64, encode("retry"));
});

test("rename and archive invalidate stale writes, while restore appends history", async () => {
  const { repository } = fixture();
  let doc = await repository.create("p", "draft.md", encode("one"), "A");
  doc = await repository.save("p", doc.id, 1, encode("two"), "A");
  doc = await repository.rename("p", doc.id, 2, "paper.md");
  await assert.rejects(
    repository.save("p", doc.id, 2, encode("stale"), "A"),
    StudioRevisionConflict,
  );
  doc = await repository.archive("p", doc.id, 3, true);
  await assert.rejects(
    repository.save("p", doc.id, 4, encode("archived"), "A"),
    /archive/,
  );
  doc = await repository.restore("p", doc.id, 4, 1, "B");
  assert.equal(doc.revision, 5);
  assert.equal(doc.archived, false);
  assert.deepEqual(
    doc.versions.map((version) => version.revision),
    [1, 2, 5],
  );
  assert.equal((await repository.read("p", doc.id)).base64, encode("one"));
  assert.equal((await repository.read("p", doc.id, 2)).base64, encode("two"));
  assert.equal(doc.versions.at(-1)!.reason, "restore");
});

test("future and corrupt catalogs are not rewritten", async () => {
  const { repository, disk } = fixture();
  const path = "/owned/projects/project-p/documents/manifest-v1.json";
  for (const value of ['{"schemaVersion":2}', "{broken"]) {
    disk.set(path, value);
    await assert.rejects(repository.create("p", "safe.md", "", "A"));
    assert.equal(disk.get(path), value);
  }
});

test("hostile names, missing content and duplicate names fail without publishing changes", async () => {
  const { repository, disk } = fixture();
  for (const name of [
    "../x",
    "/tmp/x",
    "a//b",
    "a/./b",
    "a\\b",
    "x\u0000y",
    "C:x",
  ]) {
    await assert.rejects(repository.create("p", name, "", "A"));
  }
  await assert.rejects(repository.create("../outside", "x.md", "", "A"));
  assert.equal(disk.size, 0);
  const doc = await repository.create("p", "x.md", "", "A");
  await assert.rejects(
    repository.create("p", "x.md", "", "A"),
    /already exists/,
  );
  disk.delete(
    `/owned/projects/project-p/documents/blobs/${doc.versions[0].blobID}.json`,
  );
  await assert.rejects(repository.read("p", doc.id), /missing/);
});

test("base64 and stored version validation distinguish empty data from invalid data", () => {
  assert.equal(documentByteLength(""), 0);
  assert.equal(documentByteLength("AA=="), 1);
  assert.equal(documentByteLength("AP8="), 2);
  for (const invalid of ["a", "AA=", "AA==\n", "!!!!", null, 32])
    assert.throws(() => documentByteLength(invalid));
  assert.throws(() =>
    parseStudioManifest(
      { schemaVersion: 1, projectID: "p", revision: 1, documents: [null] },
      "p",
    ),
  );
});
