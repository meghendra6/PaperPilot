import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("every parser, prompt builder, and exporter has a focused test importer", () => {
  const repositoryRoot = process.cwd();
  const sourceRoot = join(repositoryRoot, "src", "modules");
  const tests = filesBelow(join(repositoryRoot, "test"))
    .filter((path) => path.endsWith(".test.ts"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const exemptions = new Map([
    [
      "src/modules/note/promptNote.ts",
      "Zotero-backed note writer rather than a pure prompt builder",
    ],
  ]);
  const missing = filesBelow(sourceRoot)
    .filter((path) => /\/(?:parser|prompt|export)[^/]*\.ts$/.test(path))
    .map((path) => relative(repositoryRoot, path))
    .filter((path) => !exemptions.has(path))
    .filter((path) => !tests.includes(path.replace(/\.ts$/, "")));

  assert.deepEqual(
    missing,
    [],
    `Add a focused test import for: ${missing.join(", ")}`,
  );
});
