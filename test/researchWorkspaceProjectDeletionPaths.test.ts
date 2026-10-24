import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  getResearchWorkspaceProjectExportDirectory,
  getResearchWorkspaceProjectOwnedDirectories,
} from "../src/modules/researchWorkspace/persistence/projectDeletionPaths";
import { exportResearchWorkspaceTextFile } from "../src/modules/researchWorkspace/storage";

const root = "/profile/paperpilot-research-workspace";

test("project cleanup names all managed roots without selecting shared directories", () => {
  const owned = getResearchWorkspaceProjectOwnedDirectories(root, "p-1");
  assert.deepEqual(owned, [
    `${root}/projects/project-p-1`,
    `${root}/runtime/p-1`,
    `${root}/runtime/builds/p-1`,
    `${root}/runtime/context/p-1`,
    `${root}/exports/documents/p-1`,
    `${root}/exports/projects/p-1`,
  ]);
  const other = getResearchWorkspaceProjectOwnedDirectories(root, "p-10");
  for (const path of other) {
    assert.equal(
      owned.some((directory) => path.startsWith(`${directory}/`)),
      false,
      `Prefix-neighbor project must survive: ${path}`,
    );
  }
  for (const shared of ["sources", "cache", "runtime/builds", "exports"])
    assert.equal(owned.includes(`${root}/${shared}`), false);
});

test("legacy runtime namespace collisions are rejected before yielding removal paths", () => {
  for (const id of ["builds", "Builds", "BUILDS", "context", "Context"]) {
    assert.throws(
      () => getResearchWorkspaceProjectOwnedDirectories(root, id),
      /shared runtime directory/,
    );
  }
  assert.doesNotThrow(() =>
    getResearchWorkspaceProjectOwnedDirectories(root, "builds-project"),
  );
});

test("project ownership paths reject traversal, Unicode aliases, and invalid IDs", () => {
  for (const id of [
    "",
    ".",
    "..",
    "../p",
    "p/a",
    "p\\a",
    "p\0a",
    "é",
    "e\u0301",
    " project",
    "x".repeat(129),
  ]) {
    assert.throws(() => getResearchWorkspaceProjectOwnedDirectories(root, id));
    assert.throws(() => getResearchWorkspaceProjectExportDirectory(root, id));
  }
});

test("managed paths preserve Windows and Unicode profile directories", () => {
  const windowsRoot = "C:\\사용자\\프로필\\paperpilot-research-workspace\\";
  assert.deepEqual(
    getResearchWorkspaceProjectOwnedDirectories(windowsRoot, "p-1"),
    getResearchWorkspaceProjectOwnedDirectories(root, "p-1").map((path) =>
      `${windowsRoot}${path.slice(root.length + 1)}`.replace(/\//g, "\\"),
    ),
  );
});

test("exports with identical display names remain owned by distinct project IDs", async (t) => {
  const globals = globalThis as unknown as {
    Zotero?: unknown;
    PathUtils?: unknown;
  };
  const previousZotero = globals.Zotero;
  const previousPathUtils = globals.PathUtils;
  t.after(() => {
    globals.Zotero = previousZotero;
    globals.PathUtils = previousPathUtils;
  });
  const writes = new Map<string, string>();
  const directories: string[] = [];
  globals.PathUtils = undefined;
  globals.Zotero = {
    Profile: { dir: "/profile" },
    File: {
      createDirectoryIfMissingAsync: async (directory: string) => {
        directories.push(directory);
      },
      putContentsAsync: async (path: string, contents: string) => {
        writes.set(path, contents);
      },
    },
  };
  const first = await exportResearchWorkspaceTextFile("논문.md", "one", "p-1");
  const second = await exportResearchWorkspaceTextFile(
    "논문.md",
    "two",
    "p-10",
  );
  assert.equal(first, `${root}/exports/projects/p-1/-.md`);
  assert.equal(second, `${root}/exports/projects/p-10/-.md`);
  assert.equal(writes.get(first), "one");
  assert.equal(writes.get(second), "two");
  assert.deepEqual(directories, [
    `${root}/exports/projects/p-1`,
    `${root}/exports/projects/p-10`,
  ]);
  await assert.rejects(
    exportResearchWorkspaceTextFile("report.md", "bad", "../other"),
    /unsupported path characters/,
  );
  assert.equal(writes.size, 2);
  assert.equal(directories.length, 2);
  const legacy = await exportResearchWorkspaceTextFile("legacy.md", "legacy");
  assert.equal(legacy, `${root}/exports/legacy.md`);
});
