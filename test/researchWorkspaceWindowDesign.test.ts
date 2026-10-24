import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (...path: string[]) =>
  readFileSync(join(process.cwd(), ...path), "utf8");
const CONTENT = ["addon", "chrome", "content"];
const windowCss = () => read(...CONTENT, "researchWorkspaceWindow.css");

/** Splits a selector list on commas outside :is() and other parentheses. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  return [...parts, current.trim()];
}

test("the workspace window loads its design after the shared pane styles", () => {
  const window = read("src", "modules", "researchWorkspace", "window.ts");
  const pane = window.indexOf('pluginStylesheetURL("zoteroPane.css")');
  const design = window.indexOf(
    'pluginStylesheetURL("researchWorkspaceWindow.css")',
  );
  assert.ok(pane > 0 && design > pane, "the window design overrides the pane");
});

test("the window design scopes its tokens and defines both themes", () => {
  const css = windowCss();
  assert.match(css, /\.pprw-window \{[^}]*--rw-canvas:/);
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\) \{\s*\.pprw-window \{[^}]*--rw-canvas:/,
  );
  // Derived pane tokens resolve on :root, so the window sets them again.
  for (const token of [
    "--pp-accent-fill",
    "--pp-focus-color",
    "--pp-on-accent",
  ])
    assert.match(css, new RegExp(`\\.pprw-window \\{[^}]*${token}:`), token);
  // Nothing outside the window changes.
  for (const rule of css.matchAll(/^([^@\s/*}][^{}]*)\{/gm)) {
    const selectors = splitSelectors(rule[1]);
    for (const selector of selectors)
      assert.ok(
        selector.startsWith(".pprw-window") || selector.startsWith(":root"),
        `unscoped selector: ${selector}`,
      );
  }
});

test("the bundled serif ships with its license", () => {
  const css = windowCss();
  const fonts = [...css.matchAll(/url\("studio\/fonts\/([^"]+)"\)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(fonts.sort(), [
    "STIXTwoText-Italic.woff2",
    "STIXTwoText.woff2",
  ]);
  for (const file of [...fonts, "OFL.txt"])
    assert.ok(
      existsSync(join(process.cwd(), ...CONTENT, "studio", "fonts", file)),
      file,
    );
});

test("the highlighter motion stops when the reader asks for less motion", () => {
  const css = windowCss();
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.pprw-project-tab-label::before[^}]*transition: none/,
  );
  assert.match(css, /@media \(forced-colors: active\)/);
});

test("labels are sentence case without eyebrows", () => {
  assert.doesNotMatch(windowCss(), /text-transform: uppercase/);
  assert.doesNotMatch(
    read("src", "modules", "researchWorkspace", "projectHomeView.ts"),
    /pprw-eyebrow/,
  );
  assert.doesNotMatch(
    read("src", "modules", "studio", "client.ts"),
    /RESEARCH STUDIO/,
  );
});
