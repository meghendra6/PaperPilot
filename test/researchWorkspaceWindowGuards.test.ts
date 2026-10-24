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
      add.indexOf("await selection.load()"),
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
    /const initialBody = renderWindowFrame\(root\);\s*flushPendingSelectionOffer\(dialog\);/,
  );
});

test("the window home reads selected PDFs only when the reader acts", () => {
  const window = source("window.ts");
  // No separate prepare step: the home gets a lazy selection instead.
  assert.doesNotMatch(window, /Prepare captured PDFs/);
  assert.match(
    window,
    /renderResearchWorkspaceProjectSurface\(initialBody, \{\s*selection: surfaceSelection\(snapshot\),/,
  );
  const home = source("projectHomeView.ts");
  assert.match(home, /Create project with \$\{papersLabel\(count\)\}/);
  assert.match(home, /"Add to a project"/);
  // Creating with the selection opens the project with its tools ready.
  assert.match(
    home,
    /analyze: papers\.length\s*\? \{ papers, scopeLabel: SELECTION_SCOPE_LABEL \}/,
  );
});

test("a new selection moves the window unless it would lose work", () => {
  const window = source("window.ts");
  const bring = window.slice(
    window.indexOf("async function bringSelectionIntoWindow("),
    window.indexOf("async function addSnapshotToOpenProject("),
  );
  // A project that already holds the papers stays in view.
  const held = bring.indexOf("adoptSelection(body, snapshot);");
  // A running analysis, a running action, or typed text gets the offer
  // banner (spec §12.1).
  const offer = bring.indexOf(
    "(hasRunningOperation(body) || activity || hasUnsavedEdits(body))",
  );
  const move = bring.indexOf(
    "await useResearchWorkspaceSnapshot(dialog, snapshot, {",
  );
  assert.ok(held > 0 && offer > held && move > offer);
  assert.match(
    bring,
    /showSelectionOffer\(dialog, snapshot, \{\s*evenIfUnchanged: true,/,
  );
  assert.match(bring, /preferredProjectID: project\?\.projectID,/);
  // Launchers and the header button share this path.
  assert.match(
    window.slice(window.indexOf("async function offerToOpenWindow(")),
    /await bringSelectionIntoWindow\(dialog, snapshot, false\);/,
  );
  assert.match(
    window.slice(
      window.indexOf("export async function useCurrentZoteroSelection("),
    ),
    /await bringSelectionIntoWindow\(dialog, snapshot, true\);/,
  );
});

test("the home offers projects that already hold the selection", () => {
  const view = source("projectWindowView.ts");
  assert.match(
    view,
    /findResearchWorkspaceProjectsWithSources\(selection\.sourceIDs\)/,
  );
  const home = source("projectHomeView.ts");
  assert.match(home, /This paper is already in:/);
  // Creating another project is still possible but no longer the default.
  assert.match(
    home,
    /renderCreateFromSelection\(context, selection, !alreadyInProject\)/,
  );
  assert.match(home, /if \(addableProjects\(context\)\.length\)/);
});

test("a project rebuild keeps the analysis panel and the open tab", () => {
  const view = source("projectWindowView.ts");
  const render = view.slice(view.indexOf("async function renderProject("));
  assert.match(
    render,
    /const tab: ResearchWorkspaceProjectTab = options\.analyze\s*\? "analyze"\s*: sameProject\s*\? previous\.tab/,
  );
  // The kept analysis area is never removed from its panel.
  assert.match(
    render,
    /for \(const child of Array\.from\(analyze\.children\)\) \{\s*if \(child !== operations\) child\.remove\(\);/,
  );
  assert.match(
    render,
    /for \(const child of Array\.from\(root\.children\)\) \{\s*if \(child !== analyze\) child\.remove\(\);/,
  );
  // Actions that point at a panel or the tools switch to its tab first.
  assert.match(render, /revealProjectPanel\(root, panel\);/);
  assert.match(view, /selectProjectTab\(root, "analyze"\);/);
});

test("selection actions read the current selection, never earlier papers", () => {
  const view = source("projectWindowView.ts");
  const add = view.slice(
    view.indexOf("const addSelection = async () => {"),
    view.indexOf("await addPapersToResearchWorkspaceProject(projectID"),
  );
  assert.match(add, /const selection = selectionWithPapers\(root\);/);
  assert.match(add, /await loadSelectionPapers\(selection,/);
  assert.doesNotMatch(add, /capturedPapers/);
  // Read papers follow the selection the home shows.
  assert.match(
    view,
    /const capturedPapers = selection\s*\? \(selection\.loaded\(\)\?\.papers \?\? \[\]\)/,
  );
  // Accepting an offered selection makes it the project's selection.
  const window = source("window.ts");
  assert.match(
    window,
    /const selection = adoptSelection\(body, snapshot\);\s*const loaded = await selection\.load\(\);/,
  );
});

test("template settings save the values the controls show", () => {
  const panels = source("projectTemplatePanels.ts");
  const settings = panels.slice(
    panels.indexOf("export function renderProjectTemplateSettings("),
  );
  // A rebuild restores values without events, so nothing may depend on them.
  assert.doesNotMatch(settings, /addEventListener\("input"/);
  assert.match(settings, /capabilityPresetIDs: presets\.selected\(\),/);
  assert.match(
    settings,
    /assumptions: assumptionInputs\.map\(\(\{ assumption, input \}\) => \(\{\s*\.\.\.assumption,\s*value: input\.value,/,
  );
});

test("changing the single-paper choice keeps multi-paper work", () => {
  const view = source("view.ts");
  const chooser = view.slice(view.indexOf("paperChooser?.addEventListener("));
  assert.match(
    chooser,
    /if \(!chosen \|\| !current \|\| current\.busy\) return;/,
  );
  for (const kept of [
    "synthesisQuestion: synthesisQuestion.value",
    "crossAnswer: crossAnswer.value",
    "crossSessionID: current.crossSessionID",
    "crossSessionRevision: current.crossSessionRevision",
    "result: Array.from(result.childNodes)",
  ])
    assert.ok(chooser.includes(kept), kept);
  assert.match(view, /\.\.\.\(options\.keep\?\.session \?\? \{\}\),/);
  assert.match(
    view,
    /options\.keep\?\.synthesisQuestion \?\? options\.projectQuestion/,
  );
});

test("the window body scrolls inside the dialog's XUL wrappers", () => {
  const css = readFileSync(
    join(process.cwd(), "addon", "chrome", "content", "zoteroPane.css"),
    "utf8",
  );
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, `${selector} rule is missing`);
    return css.slice(start, css.indexOf("}", start));
  };
  // A percentage height does not resolve inside the DialogHelper boxes, so
  // the root must be pinned to the window for the body to overflow.
  const root = rule(".pprw-window");
  assert.match(root, /position: fixed;/);
  assert.match(root, /inset: 0;/);
  assert.doesNotMatch(root, /height: 100%;/);
  const body = rule(".pprw-window-body");
  assert.match(body, /min-height: 0;/);
  assert.match(body, /overflow: auto;/);
});

test("the home tracks typed text, so a relaunch does not drop it", () => {
  const view = source("projectWindowView.ts");
  const surface = view.slice(
    view.indexOf(
      "export async function renderResearchWorkspaceProjectSurface(",
    ),
  );
  const track = surface.indexOf("trackDirtyInputs(root);");
  const home = surface.indexOf("renderProjectHome(");
  assert.ok(
    track > 0 && track < home,
    "tracking starts before the home renders",
  );
});

test("a relaunch while the window opens draws the newest selection", () => {
  const window = source("window.ts");
  const bring = window.slice(
    window.indexOf("async function bringSelectionIntoWindow("),
  );
  assert.match(
    bring,
    /!doc\.getElementById\(WINDOW_ROOT_ID\)\?\.querySelector\("\.pprw-window-header"\)\s*\) \{[\s\S]*?snapshot,\s*status: "opening",[\s\S]*?return;/,
  );
  assert.match(
    window,
    /researchWorkspaceWindowState\?\.snapshot \?\? snapshot\)[\s\S]*?initializeResearchWorkspaceDialog\(dialog, latest\)/,
  );
});

test("a running action holds the view like a running analysis", () => {
  const window = source("window.ts");
  const bring = window.slice(
    window.indexOf("async function bringSelectionIntoWindow("),
  );
  assert.match(
    bring,
    /hasRunningOperation\(body\) \|\| activity \|\| hasUnsavedEdits\(body\)/,
  );
  const use = window.slice(
    window.indexOf("async function useResearchWorkspaceSnapshot("),
  );
  const refuse = use.indexOf("researchWorkspaceSurfaceActivity(body)");
  const release = use.indexOf("releaseWindowBody(doc");
  assert.ok(refuse > 0 && refuse < release, "an explicit switch waits too");
});
