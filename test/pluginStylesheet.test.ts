import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { pluginStylesheetURL } from "../src/utils/stylesheet";

test("plugin stylesheet URLs carry one token per add-on startup", () => {
  const pane = pluginStylesheetURL("zoteroPane.css");
  assert.match(
    pane,
    /^chrome:\/\/paperpilot\/content\/zoteroPane\.css\?v=[0-9a-z]+$/,
  );
  // Windows opened in the same session share the cached sheet.
  assert.equal(pluginStylesheetURL("zoteroPane.css"), pane);
});

test("windows load the pane stylesheet through the versioned URL", () => {
  // Gecko caches chrome stylesheets by URL for the session. A bare URL keeps
  // the previous build's CSS after an install without a restart.
  for (const file of [
    ["src", "hooks.ts"],
    ["src", "modules", "researchWorkspace", "window.ts"],
  ]) {
    const source = readFileSync(join(process.cwd(), ...file), "utf8");
    assert.doesNotMatch(source, /content\/zoteroPane\.css`/, file.join("/"));
    assert.match(
      source,
      /pluginStylesheetURL\("zoteroPane\.css"\)/,
      file.join("/"),
    );
  }
});
