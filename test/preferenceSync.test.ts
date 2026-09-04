import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

function matches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => match[1]).sort();
}

function readTypeScriptTree(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .map((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return readTypeScriptTree(path);
      return entry.isFile() && entry.name.endsWith(".ts")
        ? readFileSync(path, "utf8")
        : "";
    })
    .join("\n");
}

test("runtime defaults, generated preference types, and settings UI stay in sync", () => {
  const defaults = readFileSync("addon/prefs.js", "utf8");
  const types = readFileSync("typings/prefs.d.ts", "utf8");
  const ui = readFileSync("addon/chrome/content/preferences.xhtml", "utf8");
  const source = readTypeScriptTree("src");

  const defaultKeys = matches(defaults, /pref\(\s*"__prefsPrefix__\.([^"]+)"/g);
  const typeKeys = matches(types, /^\s*"([^"]+)":/gm);
  const uiKeys = matches(
    ui,
    /preference="extensions\.zotero\.__addonRef__\.([^"]+)"/g,
  );

  const uiExemptions = new Set(["paneSectionState"]);
  const expectedUiKeys = defaultKeys.filter((key) => !uiExemptions.has(key));

  assert.deepEqual(typeKeys, defaultKeys);
  assert.deepEqual(uiKeys, expectedUiKeys);
  for (const key of defaultKeys) {
    assert.match(
      source,
      new RegExp(`["']${key}["']`),
      `Preference ${key} must have a source call site.`,
    );
  }
});
