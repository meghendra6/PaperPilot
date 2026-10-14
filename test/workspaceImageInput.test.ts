import { test } from "node:test";
import * as assert from "node:assert/strict";
import { cleanupWorkspaceIfEnabled } from "../src/modules/workspace/cleanup";
import {
  stageWorkspaceImageInput,
  WORKSPACE_IMAGE_INPUT_PATH,
  writeOwnedWorkspaceInputs,
} from "../src/modules/workspace/supplementalFiles";

function fixture(sizes: Record<string, number> = {}) {
  const runtime = globalThis as any;
  const previous = { Zotero: runtime.Zotero, IOUtils: runtime.IOUtils };
  const files = new Map<string, string>();
  const copies: Array<[string, string]> = [];
  runtime.Zotero = {
    Prefs: { get: () => true },
    File: {
      getContentsAsync: async (path: string) => files.get(path),
      putContentsAsync: async (path: string, text: string) => {
        files.set(path, text);
      },
      createDirectoryIfMissingAsync: async () => {},
    },
  };
  runtime.IOUtils = {
    exists: async (path: string) => files.has(path),
    stat: async (path: string) => {
      if (!(path in sizes)) throw new Error("missing");
      return { type: "regular", size: sizes[path] };
    },
    copy: async (source: string, destination: string) => {
      copies.push([source, destination]);
      files.set(destination, "\u0089PNG binary");
    },
    remove: async (path: string) => {
      if ([...files.keys()].some((entry) => entry.startsWith(`${path}/`)))
        throw new Error("Directory not empty");
      files.delete(path);
    },
  };
  return { files, copies, restore: () => Object.assign(runtime, previous) };
}

test("a staged area image is runtime-owned and removed by workspace cleanup", async () => {
  const env = fixture({ "/cache/1/AREA0001.png": 2048 });
  const workspace = "/tmp/work/7-analysis-figure";
  try {
    const manifest = await writeOwnedWorkspaceInputs({
      workspacePath: workspace,
      files: { "figure-request.json": "{}" },
      runID: "run1",
      scopeFingerprint: "fp",
      sourceIDs: ["zotero:1:ITEM:PDF"],
    });
    assert.ok(
      manifest.files.some(
        (entry) =>
          entry.path === WORKSPACE_IMAGE_INPUT_PATH &&
          entry.contentFingerprint === "runtime-owned",
      ),
    );
    const staged = await stageWorkspaceImageInput(
      workspace,
      "/cache/1/AREA0001.png",
    );
    assert.equal(staged, `${workspace}/figures/selected-region.png`);
    assert.deepEqual(env.copies, [["/cache/1/AREA0001.png", staged]]);
    env.files.set(`${workspace}/figures/user-sketch.png`, "user file");

    assert.equal(await cleanupWorkspaceIfEnabled(workspace), true);
    assert.equal(env.files.has(staged), false);
    assert.equal(env.files.has(`${workspace}/figure-request.json`), false);
    assert.equal(env.files.has(`${workspace}/figures/user-sketch.png`), true);
  } finally {
    env.restore();
  }
});

test("only an existing, bounded PNG can be staged", async () => {
  const env = fixture({
    "/cache/1/BIG00001.png": 21 * 1024 * 1024,
    "/cache/1/NOTE.txt": 10,
  });
  try {
    await assert.rejects(
      stageWorkspaceImageInput("/tmp/work/7-x", "/cache/1/NOTE.txt"),
      /Only a PNG image/,
    );
    await assert.rejects(
      stageWorkspaceImageInput("/tmp/work/7-x", "/cache/1/BIG00001.png"),
      /missing or too large/,
    );
    await assert.rejects(
      stageWorkspaceImageInput("/tmp/work/7-x", "/cache/1/GONE0001.png"),
      /missing/,
    );
    assert.deepEqual(env.copies, []);
  } finally {
    env.restore();
  }
});
