import * as assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createResearchWorkspaceStorage } from "../src/modules/researchWorkspace/storage";

const root = "/profile/paperpilot-research-workspace";
const target = `${root}/runtime/owned`;

function nativeFiles(
  t: TestContext,
  symlink: (entry: string) => boolean,
  exists: (entry: string) => boolean = () => true,
) {
  const runtime = globalThis as unknown as Record<string, unknown>;
  const previous = { Zotero: runtime.Zotero, IOUtils: runtime.IOUtils };
  runtime.Zotero = {
    File: {
      pathToFile: (entry: string) => ({
        isSymlink: () => symlink(entry),
        exists: () => exists(entry),
        isDirectory: () => true,
      }),
    },
  };
  runtime.IOUtils = { getChildren: async () => [] };
  t.after(() => {
    runtime.Zotero = previous.Zotero;
    runtime.IOUtils = previous.IOUtils;
  });
  return createResearchWorkspaceStorage();
}

for (const name of [
  "NS_ERROR_FILE_NOT_FOUND",
  "NS_ERROR_FILE_TARGET_DOES_NOT_EXIST",
]) {
  test(`native removal preflight accepts an absent path reported by ${name}`, async (t) => {
    const storage = nativeFiles(t, (entry) => {
      if (entry === target) throw Object.assign(new Error("missing"), { name });
      return false;
    });
    await storage.assertSafeRemoval(target, root);
  });
}

test("native removal preflight rejects a dangling symlink before exists follows it", async (t) => {
  let followed = false;
  const storage = nativeFiles(
    t,
    (entry) => entry === target,
    (entry) => {
      if (entry === target) {
        followed = true;
        return false;
      }
      return true;
    },
  );
  await assert.rejects(
    storage.assertSafeRemoval(target, root),
    /symbolic link/,
  );
  assert.equal(followed, false);
});

test("native removal preflight preserves inspection permission failures", async (t) => {
  const failure = Object.assign(new Error("denied"), {
    name: "NS_ERROR_FILE_ACCESS_DENIED",
  });
  const storage = nativeFiles(t, (entry) => {
    if (entry === target) throw failure;
    return false;
  });
  await assert.rejects(storage.assertSafeRemoval(target, root), failure);
});
