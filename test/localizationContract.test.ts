import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function collectTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScript(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("every statically referenced Fluent key exists in en-US", () => {
  const localeRoot = join(process.cwd(), "addon", "locale", "en-US");
  const messages = readdirSync(localeRoot)
    .filter((name) => name.endsWith(".ftl"))
    .map((name) => readFileSync(join(localeRoot, name), "utf8"))
    .join("\n");
  const available = new Set(
    [...messages.matchAll(/^([a-z][a-z0-9-]+)\s*=/gim)].map(
      (match) => match[1],
    ),
  );
  const referenced = new Set<string>();
  for (const path of collectTypeScript(join(process.cwd(), "src"))) {
    if (path.endsWith(`${join("utils", "locale.ts")}`)) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /\b(?:getString|getLocaleID)\(\s*["']([^"']+)["']/g,
    )) {
      referenced.add(match[1]);
    }
  }

  assert.deepEqual(
    [...referenced].filter((key) => !available.has(key)),
    [],
  );
});

test("all translated READMEs state the English-only interface boundary", () => {
  for (const name of [
    "README.md",
    "README.ko.md",
    "README.zh-CN.md",
    "README.zh-TW.md",
  ]) {
    const source = readFileSync(join(process.cwd(), name), "utf8");
    assert.match(
      source,
      /interface.*English only|인터페이스.*영어 전용|界面.*英文|介面.*英文/i,
    );
  }
});
