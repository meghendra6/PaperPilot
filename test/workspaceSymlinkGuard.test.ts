import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { exitCodeWriter } from "../src/modules/codex/shell";
import { cleanupWorkspaceDirectory } from "../src/modules/workspace/cleanup";
import {
  findWorkspaceSymlink,
  workspaceInputContentFingerprint,
  writeOwnedWorkspaceInputs,
} from "../src/modules/workspace/supplementalFiles";
import { createGlobalStateRestorer } from "./helpers/globalState";

/**
 * Real files with Zotero-like semantics: putContentsAsync writes a fixed
 * `<path>.tmp` and renames it, as OS.File.writeAtomic does in Zotero 10.
 */
function installFileShims() {
  const restore = createGlobalStateRestorer(["Zotero", "IOUtils"]);
  const runtime = globalThis as Record<string, unknown>;
  runtime.Zotero = {
    File: {
      pathToFile: (path: string) => ({
        isSymlink: () => lstatSync(path).isSymbolicLink(),
      }),
      getContentsAsync: async (path: string) => readFileSync(path, "utf-8"),
      putContentsAsync: async (path: string, text: string) => {
        writeFileSync(`${path}.tmp`, text);
        renameSync(`${path}.tmp`, path);
      },
      createDirectoryIfMissingAsync: async (path: string) => {
        mkdirSync(path, { recursive: true });
      },
    },
  };
  runtime.IOUtils = {
    exists: async (path: string) => existsSync(path),
    remove: async (path: string) => {
      if (!existsSync(path) && !lstatSync(path, { throwIfNoEntry: false }))
        return;
      if (lstatSync(path).isDirectory()) rmSync(path, { recursive: false });
      else unlinkSync(path);
    },
  };
  return restore;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "paperpilot-symlink-"));
  const workspace = join(root, "9-chat-test");
  const victimDir = join(root, "victim");
  mkdirSync(workspace);
  mkdirSync(victimDir);
  const victim = join(victimDir, "thesis.txt");
  writeFileSync(victim, "my only copy");
  return { root, workspace, victimDir, victim };
}

test("findWorkspaceSymlink checks every component and the atomic-write sibling", async () => {
  const links = new Set(["/w/papers", "/w/paper.md.tmp"]);
  const probe = (path: string) => links.has(path);
  assert.equal(
    await findWorkspaceSymlink("/w", "papers/A.md", probe),
    "papers",
  );
  assert.equal(
    await findWorkspaceSymlink("/w", "paper.md", probe),
    "paper.md.tmp",
  );
  assert.equal(await findWorkspaceSymlink("/w", "notes.md", probe), undefined);
  // The allocated workspace directory itself must not be a link.
  assert.equal(
    await findWorkspaceSymlink("/w2/", "notes.md", (path) => path === "/w2"),
    ".",
  );
});

test("a workspace directory replaced by a link is neither written nor cleaned", async () => {
  const restore = installFileShims();
  const { root, workspace, victimDir, victim } = fixture();
  try {
    // The victim directory holds a valid-looking ownership manifest.
    writeFileSync(
      join(victimDir, "paperpilot-input-manifest.json"),
      JSON.stringify({
        version: 1,
        runID: "forged",
        scopeFingerprint: "scope",
        sourceIDs: [],
        artifactIDs: [],
        files: [
          {
            path: "thesis.txt",
            contentFingerprint:
              workspaceInputContentFingerprint("my only copy"),
          },
        ],
      }),
    );
    rmSync(workspace, { recursive: true, force: true });
    symlinkSync(victimDir, workspace);
    await assert.rejects(
      writeOwnedWorkspaceInputs({
        workspacePath: workspace,
        files: { "thesis.txt": "overwritten" },
        runID: "turn-2",
        scopeFingerprint: "scope",
        sourceIDs: ["A"],
      }),
      /symbolic link/,
    );
    assert.equal(await cleanupWorkspaceDirectory(workspace), false);
    assert.equal(readFileSync(victim, "utf-8"), "my only copy");
  } finally {
    rmSync(root, { recursive: true, force: true });
    restore();
  }
});

test("input writes refuse a planted .tmp link instead of overwriting its target", async () => {
  const restore = installFileShims();
  const { root, workspace, victim } = fixture();
  try {
    symlinkSync(victim, join(workspace, "paper.md.tmp"));
    await assert.rejects(
      writeOwnedWorkspaceInputs({
        workspacePath: workspace,
        files: { "paper.md": "injected paper text" },
        runID: "turn-2",
        scopeFingerprint: "scope",
        sourceIDs: ["A"],
      }),
      (error: Error) =>
        error.name === "WorkspacePreparationError" &&
        /symbolic link/.test(error.message),
    );
    assert.equal(readFileSync(victim, "utf-8"), "my only copy");
  } finally {
    rmSync(root, { recursive: true, force: true });
    restore();
  }
});

test("input writes refuse a dangling link planted at a planned input path", async () => {
  const restore = installFileShims();
  const { root, workspace, victimDir } = fixture();
  const created = join(victimDir, ".zprofile");
  try {
    symlinkSync(created, join(workspace, "paper.md"));
    await assert.rejects(
      writeOwnedWorkspaceInputs({
        workspacePath: workspace,
        files: { "paper.md": "injected paper text" },
        runID: "turn-2",
        scopeFingerprint: "scope",
        sourceIDs: ["A"],
      }),
      /symbolic link/,
    );
    assert.equal(existsSync(created), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    restore();
  }
});

test("cleanup never deletes through a symlinked directory named in a forged manifest", async () => {
  const restore = installFileShims();
  const { root, workspace, victimDir, victim } = fixture();
  try {
    symlinkSync(victimDir, join(workspace, "x"));
    writeFileSync(
      join(workspace, "paperpilot-input-manifest.json"),
      JSON.stringify({
        version: 1,
        runID: "forged",
        scopeFingerprint: "scope",
        sourceIDs: [],
        artifactIDs: [],
        files: [
          {
            path: "x/thesis.txt",
            contentFingerprint:
              workspaceInputContentFingerprint("my only copy"),
          },
        ],
      }),
    );
    await cleanupWorkspaceDirectory(workspace);
    assert.equal(readFileSync(victim, "utf-8"), "my only copy");
    assert.equal(
      existsSync(join(workspace, "paperpilot-input-manifest.json")),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    restore();
  }
});

test("the exit-code writer replaces a planted link instead of writing through it", () => {
  const { root, workspace, victim } = fixture();
  try {
    const exitPath = join(workspace, "codex-exit.txt");
    symlinkSync(victim, exitPath);
    const result = spawnSync(
      "/bin/sh",
      ["-c", `(sh -c 'exit 7'; ${exitCodeWriter(exitPath)})`],
      { encoding: "utf-8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(victim, "utf-8"), "my only copy");
    assert.equal(lstatSync(exitPath).isSymbolicLink(), false);
    assert.equal(readFileSync(exitPath, "utf-8"), "7");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
