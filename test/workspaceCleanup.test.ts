import { test } from "node:test";
import * as assert from "node:assert/strict";
import { cleanupWorkspaceIfEnabled } from "../src/modules/workspace/cleanup";
import { writeOwnedWorkspaceInputs } from "../src/modules/workspace/supplementalFiles";

function fixture(autoClean = true, history = true) {
  const runtime = globalThis as any;
  const previous = { Zotero: runtime.Zotero, IOUtils: runtime.IOUtils };
  const files = new Map<string, string>();
  const removals: Array<{ path: string; recursive?: boolean }> = [];
  runtime.Zotero = {
    Prefs: {
      get: (key: string) =>
        key.endsWith("codexAutoCleanWorkspace")
          ? autoClean
          : key.endsWith("saveDocumentSessions") ||
              key.endsWith("privacyStoreLocalHistory")
            ? history
            : key.endsWith("privacySavePromptsOnly")
              ? false
              : true,
    },
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
    remove: async (path: string, options: { recursive?: boolean }) => {
      removals.push({ path, recursive: options.recursive });
      if ([...files.keys()].some((entry) => entry.startsWith(`${path}/`)))
        throw new Error("Directory not empty");
      files.delete(path);
    },
  };
  return { files, removals, restore: () => Object.assign(runtime, previous) };
}

for (const history of [true, false])
  test(`manifest cleanup removes owned input and runtime files while preserving unknown contents (history=${history})`, async () => {
    const env = fixture(history, history);
    const path = "/tmp/work/42-chat-123";
    try {
      await writeOwnedWorkspaceInputs({
        workspacePath: path,
        files: { "papers/A.md": "source A", "prompt.txt": "question" },
        runID: "run1",
        sourceIDs: ["A"],
        scopeFingerprint: "A",
      });
      env.files.set(`${path}/codex-output.jsonl`, "assistant content");
      env.files.set(`${path}/claude-stderr.log`, "diagnostic");
      env.files.set(`${path}/papers/my-note.md`, "user note");
      env.files.set(`${path}/user.txt`, "user file");
      assert.equal(await cleanupWorkspaceIfEnabled(path), true);
      assert.deepEqual(
        [...env.files.keys()].sort(),
        [`${path}/papers/my-note.md`, `${path}/user.txt`].sort(),
      );
      assert(env.removals.every((entry) => entry.recursive === false));
    } finally {
      env.restore();
    }
  });

test("cleanup preserves edited inputs and blocks later replacement before any data is overwritten", async () => {
  const env = fixture();
  const path = "/tmp/work/42-chat-123";
  try {
    await writeOwnedWorkspaceInputs({
      workspacePath: path,
      files: { "paper.md": "source", "prompt.txt": "question" },
      runID: "run1",
      sourceIDs: ["A"],
      scopeFingerprint: "A",
    });
    env.files.set(`${path}/paper.md`, "user edited source");
    assert.equal(await cleanupWorkspaceIfEnabled(path), true);
    assert.equal(env.files.get(`${path}/paper.md`), "user edited source");
    assert(env.files.has(`${path}/paperpilot-input-manifest.json`));
    await assert.rejects(
      () =>
        writeOwnedWorkspaceInputs({
          workspacePath: path,
          files: { "paper.md": "new source" },
          runID: "run2",
          sourceIDs: ["A"],
          scopeFingerprint: "A",
        }),
      /changed outside/,
    );
    assert.equal(env.files.get(`${path}/paper.md`), "user edited source");
  } finally {
    env.restore();
  }
});

test("disabled cleanup with retained history leaves all files", async () => {
  const env = fixture(false, true);
  try {
    assert.equal(
      await cleanupWorkspaceIfEnabled("/tmp/work/42-chat-123"),
      false,
    );
    assert.equal(env.removals.length, 0);
  } finally {
    env.restore();
  }
});

test("legacy, corrupt, unsafe and traversal workspaces are never recursively deleted", async () => {
  const env = fixture();
  try {
    env.files.set("/tmp/work/42-legacy/paper.md", "legacy");
    env.files.set(
      "/tmp/work/43-chat-123/paperpilot-input-manifest.json",
      "broken",
    );
    for (const path of [
      "/tmp/work/42-legacy",
      "/tmp/work/43-chat-123",
      "/tmp/work",
      "/tmp/work/../42-chat-123",
    ])
      assert.equal(await cleanupWorkspaceIfEnabled(path), false);
    assert.equal(env.removals.length, 0);
    assert.equal(env.files.get("/tmp/work/42-legacy/paper.md"), "legacy");
  } finally {
    env.restore();
  }
});

test("malformed runtime ownership and duplicate paths cannot authorize deletion", async () => {
  const env = fixture();
  const path = "/tmp/work/42-chat-123";
  try {
    const base = {
      version: 1,
      runID: "run",
      scopeFingerprint: "A",
      sourceIDs: ["A"],
      artifactIDs: [],
    };
    env.files.set(`${path}/notes.md`, "user note");
    for (const entries of [
      [{ path: "notes.md", contentFingerprint: "runtime-owned" }],
      [
        { path: "codex-output.jsonl", contentFingerprint: "runtime-owned" },
        { path: "codex-output.jsonl", contentFingerprint: "runtime-owned" },
      ],
    ]) {
      env.files.set(
        `${path}/paperpilot-input-manifest.json`,
        JSON.stringify({ ...base, files: entries }),
      );
      assert.equal(await cleanupWorkspaceIfEnabled(path), false);
      await assert.rejects(
        () =>
          writeOwnedWorkspaceInputs({
            workspacePath: path,
            files: { "paper.md": "source" },
            runID: "new",
            sourceIDs: ["A"],
            scopeFingerprint: "A",
          }),
        /preserved/,
      );
    }
    assert.equal(env.removals.length, 0);
    assert.equal(env.files.get(`${path}/notes.md`), "user note");
  } finally {
    env.restore();
  }
});
