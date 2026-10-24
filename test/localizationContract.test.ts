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
    // Runtime messages that setFluentMessage() prefixes with getLocaleID().
    for (const match of source.matchAll(
      /\b(?:l10nId|unrecognizedL10nId):\s*["']([^"']+)["']/g,
    )) {
      referenced.add(match[1]);
    }
  }

  assert.deepEqual(
    [...referenced].filter((key) => !available.has(key)),
    [],
  );
});

test("READMEs distinguish English controls from localized Critical Read guidance", () => {
  const expectations: Array<[string, RegExp]> = [
    [
      "README.md",
      /most controls use English labels; Critical Read.*response-language/,
    ],
    ["README.ko.md", /대부분의 조작 항목은 영어이며, Critical Read.*응답 언어/],
    ["README.zh-CN.md", /大多数控件使用英文；Critical Read.*响应语言/],
    ["README.zh-TW.md", /大多數控制項使用英文；Critical Read.*回應語言/],
  ];
  for (const [name, pattern] of expectations) {
    const source = readFileSync(join(process.cwd(), name), "utf8");
    assert.match(source, pattern, `${name} must document localized guidance`);
    assert.doesNotMatch(
      source,
      /interface.*English only|인터페이스.*영어 전용|界面.*仅提供英文|介面.*僅提供英文/i,
    );
  }
});
