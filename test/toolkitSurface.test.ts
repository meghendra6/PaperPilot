import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("Paper Pilot never constructs the toolkit parts that register global handlers", () => {
  // ZoteroToolkit's PromptManager installs zotero://plugin and
  // zotero://ztoolkit-debug handlers; FieldHooks and Keyboard patch Zotero.
  const forbidden =
    /\b(?:ZoteroToolkit|PromptManager|FieldHookManager|KeyboardManager)\b/;
  const offenders = filesBelow(join(process.cwd(), "src"))
    .filter((path) => path.endsWith(".ts"))
    .filter((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .some(
          (line) =>
            /from "zotero-plugin-toolkit"/.test(line) && forbidden.test(line),
        ),
    )
    .map((path) => relative(process.cwd(), path));
  assert.deepEqual(offenders, []);
});
