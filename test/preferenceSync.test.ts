import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

function keys(source: string, pattern: RegExp) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

function readTypeScriptBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readTypeScriptBelow(path);
    return entry.isFile() && entry.name.endsWith(".ts")
      ? [readFileSync(path, "utf8")]
      : [];
  });
}

test("preference defaults, types, UI declarations, and source usage stay in sync", () => {
  const root = process.cwd();
  const defaults = readFileSync(join(root, "addon", "prefs.js"), "utf8");
  const types = readFileSync(join(root, "typings", "prefs.d.ts"), "utf8");
  const ui = readFileSync(
    join(root, "addon", "chrome", "content", "preferences.xhtml"),
    "utf8",
  );
  const sourceFiles = readFileSync(
    join(root, "test", "preferenceSync.test.ts"),
    "utf8",
  );
  const source = readTypeScriptBelow(join(root, "src")).join("\n");

  const defaultKeys = keys(defaults, /__prefsPrefix__\.([A-Za-z0-9]+)["']/g);
  const typeKeys = keys(types, /"([A-Za-z0-9]+)"\s*:/g);
  const uiKeys = keys(
    ui,
    /preference="extensions\.zotero\.__addonRef__\.([A-Za-z0-9]+)"/g,
  );
  const internalOnly = new Set(["paneSectionState"]);

  assert.deepEqual(typeKeys, defaultKeys);
  assert.deepEqual(
    new Set([...defaultKeys].filter((key) => !internalOnly.has(key))),
    uiKeys,
  );
  for (const key of defaultKeys) {
    assert.match(
      source,
      new RegExp(`["']${key}["']`),
      `unused preference: ${key}`,
    );
  }
  assert.doesNotMatch(sourceFiles, /extensions\.zotero\.paperpilot\./);
});
