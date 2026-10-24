import { element } from "./dom";

export type ResearchWorkspaceProjectTab =
  | "analyze"
  | "papers"
  | "results"
  | "checks"
  | "settings";

export interface ResearchWorkspaceProjectTabDefinition {
  id: ResearchWorkspaceProjectTab;
  label: string;
  hint: string;
}

/** The project page sections, in tab order. Analyze opens first. */
export const RESEARCH_WORKSPACE_PROJECT_TABS: readonly ResearchWorkspaceProjectTabDefinition[] =
  Object.freeze([
    {
      id: "analyze",
      label: "Analyze",
      hint: "Choose papers and run comparisons, matrices, and audits.",
    },
    {
      id: "papers",
      label: "Papers",
      hint: "Add papers, track reading, and screen them.",
    },
    {
      id: "results",
      label: "Results",
      hint: "Every saved analysis, with its sources and versions.",
    },
    {
      id: "checks",
      label: "Checks",
      hint: "Contradictions, citation health, and changes in Zotero.",
    },
    {
      id: "settings",
      label: "Settings",
      hint: "Name, research question, export, Zotero sync, and archive.",
    },
  ]);

export const DEFAULT_RESEARCH_WORKSPACE_PROJECT_TAB: ResearchWorkspaceProjectTab =
  "analyze";

export function isResearchWorkspaceProjectTab(
  value: unknown,
): value is ResearchWorkspaceProjectTab {
  return RESEARCH_WORKSPACE_PROJECT_TABS.some((tab) => tab.id === value);
}

/** The tab a roving-focus key moves to, or undefined for other keys. */
export function projectTabForKey(
  current: ResearchWorkspaceProjectTab,
  key: string,
): ResearchWorkspaceProjectTab | undefined {
  const ids = RESEARCH_WORKSPACE_PROJECT_TABS.map((tab) => tab.id);
  const index = ids.indexOf(current);
  if (key === "ArrowRight") return ids[(index + 1) % ids.length];
  if (key === "ArrowLeft") return ids[(index - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return undefined;
}

/** A tab label with its item count, for example "Papers 3". */
export function projectTabLabel(
  tab: ResearchWorkspaceProjectTabDefinition,
  counts: Partial<Record<ResearchWorkspaceProjectTab, number>>,
): string {
  const count = counts[tab.id];
  return typeof count === "number" ? `${tab.label} ${count}` : tab.label;
}

function tabID(suffix: string, tab: ResearchWorkspaceProjectTab) {
  return `pprw-project-tab-${suffix}-${tab}`;
}

function panelID(suffix: string, tab: ResearchWorkspaceProjectTab) {
  return `pprw-project-tabpanel-${suffix}-${tab}`;
}

export function renderProjectTabBar(
  doc: Document,
  params: {
    idSuffix: string;
    active: ResearchWorkspaceProjectTab;
    counts: Partial<Record<ResearchWorkspaceProjectTab, number>>;
    onSelect: (tab: ResearchWorkspaceProjectTab) => void;
  },
): HTMLElement {
  const bar = element(doc, "div", "pprw-project-tabs");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Project sections");
  for (const tab of RESEARCH_WORKSPACE_PROJECT_TABS) {
    const node = element(doc, "button", "pprw-project-tab");
    // The label and count are separate so the highlighter marks only the
    // label. The space keeps the accessible name "Papers 3".
    node.append(element(doc, "span", "pprw-project-tab-label", tab.label));
    const count = params.counts[tab.id];
    if (typeof count === "number")
      node.append(
        " ",
        element(doc, "span", "pprw-project-tab-count", String(count)),
      );
    node.type = "button";
    node.id = tabID(params.idSuffix, tab.id);
    node.dataset.tab = tab.id;
    node.title = tab.hint;
    node.setAttribute("role", "tab");
    node.setAttribute("aria-controls", panelID(params.idSuffix, tab.id));
    node.addEventListener("click", () => params.onSelect(tab.id));
    node.addEventListener("keydown", (event: KeyboardEvent) => {
      const next = projectTabForKey(tab.id, event.key);
      if (!next) return;
      event.preventDefault();
      params.onSelect(next);
      bar.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
    });
    bar.append(node);
  }
  syncProjectTabBar(bar, params.active);
  return bar;
}

export function renderProjectTabPanel(
  doc: Document,
  idSuffix: string,
  tab: ResearchWorkspaceProjectTab,
): HTMLElement {
  const panel = element(doc, "div", "pprw-project-tabpanel");
  panel.id = panelID(idSuffix, tab);
  panel.dataset.tab = tab;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", tabID(idSuffix, tab));
  return panel;
}

function syncProjectTabBar(
  bar: HTMLElement,
  active: ResearchWorkspaceProjectTab,
) {
  for (const node of Array.from(
    bar.querySelectorAll("[role='tab']"),
  ) as HTMLElement[]) {
    const selected = node.dataset.tab === active;
    node.setAttribute("aria-selected", String(selected));
    node.tabIndex = selected ? 0 : -1;
  }
}

/** Shows one tab panel under root and marks its tab as selected. */
export function showProjectTab(
  root: HTMLElement,
  active: ResearchWorkspaceProjectTab,
): void {
  const bar = root.querySelector<HTMLElement>(".pprw-project-tabs");
  if (bar) syncProjectTabBar(bar, active);
  for (const panel of Array.from(
    root.querySelectorAll(".pprw-project-tabpanel"),
  ) as HTMLElement[]) {
    panel.hidden = panel.dataset.tab !== active;
  }
}

/** The tab whose panel contains node, if any. */
export function projectTabOf(
  node: Element | null | undefined,
): ResearchWorkspaceProjectTab | undefined {
  const tab = node?.closest<HTMLElement>(".pprw-project-tabpanel")?.dataset.tab;
  return isResearchWorkspaceProjectTab(tab) ? tab : undefined;
}
