import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_RESEARCH_WORKSPACE_PROJECT_TAB,
  RESEARCH_WORKSPACE_PROJECT_TABS,
  isResearchWorkspaceProjectTab,
  projectTabForKey,
  projectTabLabel,
} from "../src/modules/researchWorkspace/projectTabs";

test("the project page opens on Analyze and keeps a fixed tab order", () => {
  assert.equal(DEFAULT_RESEARCH_WORKSPACE_PROJECT_TAB, "analyze");
  assert.deepEqual(
    RESEARCH_WORKSPACE_PROJECT_TABS.map((tab) => tab.id),
    ["analyze", "papers", "results", "checks", "settings"],
  );
  for (const tab of RESEARCH_WORKSPACE_PROJECT_TABS) {
    assert.ok(tab.hint.length > 0, `${tab.id} explains itself`);
  }
});

test("arrow, Home, and End keys move between tabs and wrap around", () => {
  assert.equal(projectTabForKey("analyze", "ArrowRight"), "papers");
  assert.equal(projectTabForKey("settings", "ArrowRight"), "analyze");
  assert.equal(projectTabForKey("analyze", "ArrowLeft"), "settings");
  assert.equal(projectTabForKey("results", "Home"), "analyze");
  assert.equal(projectTabForKey("results", "End"), "settings");
  assert.equal(projectTabForKey("results", "Enter"), undefined);
});

test("tab labels show counts only where a count is given", () => {
  const [analyze, papers] = RESEARCH_WORKSPACE_PROJECT_TABS;
  assert.equal(projectTabLabel(papers, { papers: 3 }), "Papers 3");
  assert.equal(projectTabLabel(papers, { papers: 0 }), "Papers 0");
  assert.equal(projectTabLabel(analyze, { papers: 3 }), "Analyze");
  assert.equal(isResearchWorkspaceProjectTab("checks"), true);
  assert.equal(isResearchWorkspaceProjectTab("overview"), false);
});

test("tabs follow the ARIA tab pattern with roving focus", () => {
  const source = readFileSync(
    join(process.cwd(), "src/modules/researchWorkspace/projectTabs.ts"),
    "utf8",
  );
  assert.match(source, /setAttribute\("role", "tablist"\)/);
  assert.match(source, /setAttribute\("role", "tab"\)/);
  assert.match(source, /setAttribute\("role", "tabpanel"\)/);
  assert.match(source, /setAttribute\("aria-controls", panelID/);
  assert.match(source, /setAttribute\("aria-labelledby", tabID/);
  assert.match(source, /node\.tabIndex = selected \? 0 : -1;/);
  assert.match(source, /panel\.hidden = panel\.dataset\.tab !== active;/);
});

test("Studio is reachable from the home and the project, with a guided start", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");
  const home = read("src/modules/researchWorkspace/projectHomeView.ts");
  const project = read("src/modules/researchWorkspace/projectWindowView.ts");
  assert.match(
    home,
    /"Open Studio",\s*\(\) =>\s*openStudio\(project\.projectID\)/,
  );
  assert.match(
    project,
    /"Open Studio",\s*\(\) => openStudio\(details\.project\.projectID\)/,
  );
  assert.doesNotMatch(project, /Write & run/);
  const client = read("src/modules/studio/client.ts");
  for (const card of [
    "Write a draft",
    "Cite your papers",
    "Ask the assistant",
    "Analyze data",
    "Plan the work",
    "Import files",
  ])
    assert.match(client, new RegExp(`"${card}"`));
});
