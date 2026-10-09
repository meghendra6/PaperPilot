import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = (file: string) =>
  readFileSync(
    join(process.cwd(), "src", "modules", "researchWorkspace", file),
    "utf8",
  );

test("opening another project asks before it takes over the window", () => {
  const view = source("projectWindowView.ts");
  const render = view.slice(view.indexOf("async function renderProject("));
  const release = render.indexOf(
    'releaseOperations(root, "Opening another project")',
  );
  const takeOver = render.indexOf("generations.set(root, generation);");
  assert.ok(release > 0 && takeOver > 0);
  assert.ok(release < takeOver, "the prompt must come before the takeover");
});

test("a selection is not added to a project while its analysis runs", () => {
  const window = source("window.ts");
  const add = window.slice(
    window.indexOf("async function addSnapshotToOpenProject("),
  );
  assert.match(
    add,
    /if \(hasRunningOperation\(body\)\) \{\s*throw new Error\(\s*"An analysis is running in this project\./,
  );
  assert.ok(
    add.indexOf("hasRunningOperation(body)") <
      add.indexOf("loadResearchWorkspaceSnapshotPapers("),
  );
});

test("a selection captured while the window opens is shown once the header exists", () => {
  const window = source("window.ts");
  assert.match(
    window,
    /if \(!root\?\.querySelector\("\.pprw-window-header"\)\) \{\s*pendingSelectionOffer = \{ dialog, snapshot \};/,
  );
  assert.match(
    window,
    /const initialBody = renderWindowFrame\(root, snapshot, snapshot\.skipped\);\s*flushPendingSelectionOffer\(dialog\);/,
  );
});
