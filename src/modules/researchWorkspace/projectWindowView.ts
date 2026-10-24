import { renderProjectCandidateInbox } from "./projectCandidatePanel";
import { openStudio } from "../studio/window";
import { isResearchWorkspaceMemberExcluded } from "./memberState";
import { isResearchWorkspaceOwnerActive } from "./projectRunAdmission";
import { button as plainButton, element } from "./dom";
import { planResearchWorkspaceArtifactRerun } from "./artifactRerun";
import {
  addPapersToResearchWorkspaceProject,
  archiveResearchWorkspaceProject,
  exportIntegratedResearchWorkspace,
  findResearchWorkspaceProjectsWithSources,
  listResearchWorkspaceZoteroSyncReceipts,
  loadResearchWorkspaceChangeInbox,
  loadResearchWorkspaceHome,
  loadResearchWorkspaceProject,
  loadResearchWorkspaceProjectPapers,
  restoreResearchWorkspaceProject,
  updateResearchWorkspaceProject,
} from "./facade";
import type { ResearchWorkspacePaper } from "./paperSource";
import {
  RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
  type ResearchWorkspaceArtifact,
  type ResearchWorkspaceChangeInboxFile,
} from "./persistence/contracts";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import { projectDeleteButton } from "./projectDeleteAction";
import { renderProjectHome } from "./projectHomeView";
import {
  renderArtifactHistory,
  renderCitationHealthPanel,
  renderContradictionGapPanel,
  renderLivingReviewPanel,
  renderProjectPapers,
  renderScreeningLog,
} from "./projectReviewPanels";
import {
  activeOperationRoots,
  addedPapersMessage,
  button,
  disposeOperations,
  generations,
  isCurrent,
  labeledField,
  loadSelectionPapers,
  logProjectError,
  releaseOperations,
  selectionWithPapers,
  setMessage,
  surfaceSelections,
  textInput,
  type ProjectNavigation,
  type ProjectOpenOptions,
} from "./projectSurfaceShared";
import {
  captureSurfaceState,
  restoreSurfaceState,
  trackDirtyInputs,
} from "./projectSurfaceState";
import { renderSafeZoteroSyncPanel } from "./projectSyncPanel";
import {
  DEFAULT_RESEARCH_WORKSPACE_PROJECT_TAB,
  projectTabOf,
  renderProjectTabBar,
  renderProjectTabPanel,
  showProjectTab,
  type ResearchWorkspaceProjectTab,
} from "./projectTabs";
import { renderProjectTemplateSettings } from "./projectTemplatePanels";
import { papersLabel } from "./surfaceSelection";
import type { ResearchWorkspaceSurfaceSelection } from "./surfaceSelection";
import {
  renderResearchWorkspaceView,
  triggerResearchWorkspaceViewAction,
} from "./view";
import type { ResearchWorkspaceZoteroSyncReceiptFile } from "./zoteroSync";

interface ProjectSurfaceContext {
  projectID: string;
  projectName: string;
  capturedPapers: readonly ResearchWorkspacePaper[];
  tab: ResearchWorkspaceProjectTab;
}

/** The project currently shown on each surface root, for window actions. */
const projectContexts = new WeakMap<HTMLElement, ProjectSurfaceContext>();

/** Tab IDs stay stable per surface, so a kept analysis panel keeps its ID. */
const tabSuffixes = new WeakMap<HTMLElement, string>();
let tabSuffixCounter = 0;

function tabSuffix(root: HTMLElement) {
  let suffix = tabSuffixes.get(root);
  if (!suffix) {
    suffix = String(++tabSuffixCounter);
    tabSuffixes.set(root, suffix);
  }
  return suffix;
}

const navigation: ProjectNavigation = {
  renderProject,
  renderHome: renderResearchWorkspaceProjectSurface,
};

const SELECTION_SCOPE_LABEL = "Zotero selection";
const ANALYSIS_BATCH_LIMIT = 12;

function selectProjectTab(root: HTMLElement, tab: ResearchWorkspaceProjectTab) {
  const context = projectContexts.get(root);
  if (context) context.tab = tab;
  showProjectTab(root, tab);
}

/** Shows the tab that holds node, for actions that point at a panel. */
function revealProjectPanel(root: HTMLElement, node: Element | null) {
  const tab = projectTabOf(node);
  if (tab) selectProjectTab(root, tab);
}

function archiveNotice(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const archivedAt = details.project.archivedAt;
  if (!archivedAt) return undefined;
  const notice = element(doc, "div", "pprw-project-warning pprw-row");
  notice.append(
    element(
      doc,
      "span",
      "",
      `Archived ${new Date(archivedAt).toLocaleDateString()}. Living Review does not check archived projects.`,
    ),
    button(
      doc,
      "Restore",
      async () => {
        setMessage(root, "Restoring project…");
        await restoreResearchWorkspaceProject(details.project.projectID);
        await renderProject(
          root,
          details.project.projectID,
          capturedPapers,
          generation,
        );
        setMessage(root, "Project restored to Your projects.", "success");
      },
      true,
    ),
  );
  return notice;
}

function renderProjectHeader(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
) {
  const header = element(doc, "div", "pprw-project-header");
  const toolbar = element(doc, "div", "pprw-project-toolbar");
  const back = button(doc, "← All projects", () =>
    renderResearchWorkspaceProjectSurface(root, { capturedPapers }),
  );
  back.setAttribute("aria-label", "All projects");
  const title = element(doc, "h2", "", details.project.name);
  title.title = details.project.name;
  const studio = button(
    doc,
    "Open Studio",
    () => openStudio(details.project.projectID),
    true,
  );
  studio.title =
    "Write drafts, cite this project's Zotero papers, run notebooks, and ask the assistant in Research Studio.";
  toolbar.append(back, title, studio);
  // The research question reads as the project's subtitle. Without one,
  // the line says where to add it.
  const question = details.project.researchQuestion?.trim();
  const questionLine = question
    ? element(doc, "p", "pprw-project-question", question)
    : element(
        doc,
        "p",
        "pprw-project-question pprw-project-question--empty",
        "No research question yet. Add one in Settings.",
      );
  const meta = element(
    doc,
    "p",
    "pprw-project-meta",
    `${papersLabel(details.members.length)}, ${details.artifacts.length} saved result${details.artifacts.length === 1 ? "" : "s"}`,
  );
  header.append(toolbar, questionLine, meta);
  return header;
}

function renderProjectSettings(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const projectID = details.project.projectID;
  const settings = element(doc, "section", "pprw-project-panel");
  settings.append(element(doc, "h3", "", "Project settings"));
  const name = textInput(doc, "Project name", details.project.name);
  const question = textInput(
    doc,
    "Research question",
    details.project.researchQuestion ?? "",
  );
  const settingsActions = element(doc, "div", "pprw-row");
  settingsActions.append(
    button(
      doc,
      "Save project",
      async () => {
        try {
          setMessage(root, "Saving project…");
          await updateResearchWorkspaceProject(projectID, {
            name: name.value,
            researchQuestion: question.value || undefined,
          });
          await renderProject(root, projectID, capturedPapers, generation);
          setMessage(root, "Project saved.", "success");
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      },
      true,
    ),
    button(doc, "Export JSON + Markdown", async () => {
      try {
        setMessage(root, "Exporting this project…");
        const result = await exportIntegratedResearchWorkspace({ projectID });
        const warnings = result.warnings ?? [];
        setMessage(
          root,
          `Exported to ${result.jsonPath} and ${result.markdownPath}.${
            warnings.length
              ? ` ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.slice(0, 3).join(" ")}`
              : ""
          }`,
          warnings.length ? "warning" : "success",
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    }),
  );
  if (!details.project.archivedAt) {
    settingsActions.append(
      button(doc, "Archive", async () => {
        const confirmed =
          doc.defaultView?.confirm(
            `Archive “${details.project.name}”? It moves to Archived projects and Living Review stops checking it. You can open or restore it later.`,
          ) ?? false;
        if (!confirmed) return;
        if (!releaseOperations(root, "Archiving this project")) return;
        await archiveResearchWorkspaceProject(projectID);
        await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
        setMessage(
          root,
          `Archived “${details.project.name}”. Restore it from Archived projects.`,
          "success",
        );
      }),
    );
  }
  settingsActions.append(
    projectDeleteButton(root, details.project, () =>
      renderResearchWorkspaceProjectSurface(root, { capturedPapers }),
    ),
  );
  settings.append(
    labeledField(doc, "Project name", name),
    labeledField(
      doc,
      "Research question",
      question,
      "Project synthesis and other analyses start from this question.",
    ),
    settingsActions,
  );
  return settings;
}

/**
 * The papers selected in Zotero that this project could add, with an add
 * action, or a hint for bringing papers in.
 */
function renderAddFromZotero(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  addSelection: () => Promise<void>,
) {
  const section = element(doc, "section", "pprw-project-panel pprw-add-papers");
  section.append(element(doc, "h3", "", "Add papers from Zotero"));
  const selection = selectionWithPapers(root);
  const members = new Set(details.members.map((member) => member.sourceID));
  const fresh = selection
    ? selection.sourceIDs.filter((sourceID) => !members.has(sourceID)).length
    : 0;
  if (!selection || !fresh) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        selection
          ? `The ${papersLabel(selection.titles.length)} selected in Zotero ${selection.titles.length === 1 ? "is" : "are"} already in this project.`
          : "Select papers in the Zotero library, then choose Use Zotero selection at the top of this window. You can also right-click them and choose Open Research Workspace….",
      ),
    );
    return section;
  }
  section.append(
    element(
      doc,
      "p",
      "pprw-muted",
      `${papersLabel(fresh)} selected in Zotero ${fresh === 1 ? "is" : "are"} not in this project yet.`,
    ),
    button(
      doc,
      `Add ${papersLabel(fresh)} to this project`,
      addSelection,
      true,
    ),
  );
  return section;
}

/** The analysis placeholder until the reader opens the tools. */
function renderAnalysisPlaceholder(doc: Document) {
  const placeholder = element(doc, "div", "pprw-analysis-placeholder");
  placeholder.append(
    element(doc, "h3", "", "Analysis tools"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Choose papers above and select Open analysis tools. Paper Pilot reads their PDFs on this computer. Nothing is sent to a model until you run a tool.",
    ),
  );
  const tools = element(doc, "ul", "pprw-tool-preview");
  for (const [name, text] of [
    [
      "Quick Compare and Evidence Matrix",
      "compare methods, data, and results side by side, with quotes linked to PDF pages.",
    ],
    ["Project synthesis", "answers the research question across the papers."],
    [
      "Claim ledger, Methodology Audit, Reproducibility",
      "examine one paper closely.",
    ],
  ]) {
    const item = element(doc, "li", "");
    item.append(element(doc, "strong", "", name), ` ${text}`);
    tools.append(item);
  }
  placeholder.append(tools);
  return placeholder;
}

async function renderProject(
  root: HTMLElement,
  projectID: string,
  capturedPapers: readonly ResearchWorkspacePaper[],
  _parentGeneration: symbol,
  options: ProjectOpenOptions = {},
) {
  const generation = Symbol("project-render");
  // Refreshing the same project keeps the analysis area, its running
  // operation, and its last result in place. Panels around it are rebuilt.
  // Ask before this render takes over the window, so "Keep running" leaves
  // the current project fully working.
  const previousOperations = activeOperationRoots.get(root);
  const keepOperations = previousOperations?.dataset.projectId === projectID;
  if (!keepOperations && !releaseOperations(root, "Opening another project"))
    return;
  generations.set(root, generation);
  const [details, changeInboxResult, syncReceiptResult] = await Promise.all([
    loadResearchWorkspaceProject(projectID),
    // Only the Living Review panel needs the inbox. An unreadable file (for
    // example after a downgrade) must not keep the whole project closed.
    loadResearchWorkspaceChangeInbox(projectID)
      .then((inbox) => ({ inbox, warning: undefined as string | undefined }))
      .catch(() => ({
        inbox: {
          schemaVersion: RESEARCH_WORKSPACE_CHANGE_INBOX_SCHEMA_VERSION,
          revision: 0,
          projectID,
          snapshots: [],
          changes: [],
        } satisfies ResearchWorkspaceChangeInboxFile,
        warning:
          "The Living Review change inbox could not be read. The file was preserved; Living Review stays unavailable until it is repaired.",
      })),
    listResearchWorkspaceZoteroSyncReceipts(projectID)
      .then((receipts) => ({
        receipts,
        warning: undefined as string | undefined,
      }))
      .catch(() => ({
        receipts: [] as ResearchWorkspaceZoteroSyncReceiptFile[],
        warning:
          "Sync receipt history could not be read. Existing receipt files were preserved; apply and undo remain unavailable until the history is repaired.",
      })),
  ]);
  if (!isCurrent(root, generation)) return;
  const doc = root.ownerDocument;
  // A rebuild of the same project keeps unsaved panel choices and the open
  // tab, whether or not an analysis has been prepared.
  const previous = projectContexts.get(root);
  const sameProject = previous?.projectID === projectID;
  const tab: ResearchWorkspaceProjectTab = options.analyze
    ? "analyze"
    : sameProject
      ? previous.tab
      : DEFAULT_RESEARCH_WORKSPACE_PROJECT_TAB;
  projectContexts.set(root, {
    projectID,
    projectName: details.project.name,
    capturedPapers,
    tab,
  });
  const suffix = tabSuffix(root);

  const before = doc.createDocumentFragment();
  before.append(renderProjectHeader(doc, root, details, capturedPapers));
  const message = element(doc, "div", "pprw-status", "Project ready.");
  message.dataset.projectMessage = "true";
  message.dataset.kind = "success";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.tabIndex = -1;
  before.append(message);
  // F232: unreadable artifacts and missing sources are listed, not hidden.
  if (details.warnings.length) {
    const warnings = element(doc, "ul", "pprw-project-warning");
    warnings.setAttribute("aria-label", "Project warnings");
    for (const warning of details.warnings.slice(0, 10)) {
      warnings.append(element(doc, "li", "", warning));
    }
    if (details.warnings.length > 10) {
      warnings.append(
        element(doc, "li", "", `and ${details.warnings.length - 10} more`),
      );
    }
    before.append(warnings);
  }
  const archived = archiveNotice(
    doc,
    root,
    details,
    capturedPapers,
    generation,
  );
  if (archived) before.append(archived);
  before.append(
    renderProjectTabBar(doc, {
      idSuffix: suffix,
      active: tab,
      counts: {
        papers: details.members.length,
        results: details.artifacts.length,
      },
      onSelect: (next) => selectProjectTab(root, next),
    }),
  );

  const panels = {
    papers: renderProjectTabPanel(doc, suffix, "papers"),
    results: renderProjectTabPanel(doc, suffix, "results"),
    checks: renderProjectTabPanel(doc, suffix, "checks"),
    settings: renderProjectTabPanel(doc, suffix, "settings"),
  };

  const operations =
    keepOperations && previousOperations
      ? previousOperations
      : element(doc, "section", "pprw-project-operations");
  operations.dataset.projectId = projectID;
  operations.tabIndex = -1;
  operations.setAttribute("aria-label", "Analysis");
  if (!operations.childElementCount)
    operations.append(renderAnalysisPlaceholder(doc));
  const activate = async (
    papers: readonly ResearchWorkspacePaper[],
    scopeLabel: string,
  ) => {
    if (!isCurrent(root, generation)) return false;
    if (!papers.length)
      throw new Error(
        "No readable non-excluded PDF is available in this scope.",
      );
    if (!releaseOperations(root, "Preparing a new analysis scope"))
      return false;
    selectProjectTab(root, "analyze");
    activeOperationRoots.set(root, operations);
    await renderResearchWorkspaceView(operations, undefined, {
      preloadedPaper: papers[0],
      capturedPapers: papers,
      standalone: true,
      projectID,
      projectQuestion: details.project.researchQuestion,
      scopeLabel,
      recommendedCapabilityIDs: details.project.capabilityPresetIDs,
      // New artifacts unlock prerequisite-gated panels.
      onRunSettled: () => void refreshResearchWorkspaceProject(root),
    });
    // The analysis panel sits below the scope. Bring it into view and move
    // focus there so keyboard and screen-reader users follow.
    operations.scrollIntoView?.({ block: "start" });
    operations.focus?.({ preventScroll: true });
    return true;
  };
  const rerunArtifact = async (artifact: ResearchWorkspaceArtifact) => {
    const plan = planResearchWorkspaceArtifactRerun(artifact);
    if (plan.kind === "reader") {
      setMessage(root, plan.message);
      return;
    }
    if (plan.kind === "panel") {
      const panel = root.querySelector<HTMLElement>(`.${plan.panelClass}`);
      revealProjectPanel(root, panel);
      const target = (
        Array.from(
          panel?.querySelectorAll("button") ?? [],
        ) as HTMLButtonElement[]
      ).find((node) => node.textContent?.trim() === plan.buttonLabel);
      panel?.scrollIntoView?.({ block: "start" });
      if (!target || target.disabled) {
        setMessage(
          root,
          `${plan.buttonLabel} is unavailable until its saved inputs are current.`,
          "warning",
        );
        return;
      }
      target.focus();
      // Start after this action releases the shared surface lock.
      doc.defaultView?.setTimeout(() => target.click(), 0);
      return;
    }
    if (isResearchWorkspaceOwnerActive({ kind: "project", projectID }))
      throw new Error(
        "Finish or cancel the active project analysis before rerunning an artifact.",
      );
    setMessage(root, `Preparing the sources of “${artifact.title}”…`);
    const loaded = await loadResearchWorkspaceProjectPapers(projectID, [
      ...plan.sourceIDs,
    ]);
    if (loaded.papers.length < plan.minSources)
      throw new Error(
        `Rerunning “${artifact.title}” needs ${plan.minSources} readable source${plan.minSources === 1 ? "" : "s"}; ${loaded.papers.length} loaded.${loaded.skipped.length ? ` Omitted: ${loaded.skipped.join("; ")}` : ""}`,
      );
    if (!(await activate(loaded.papers, `rerun of “${artifact.title}”`)))
      return;
    const started = triggerResearchWorkspaceViewAction(
      operations,
      plan.buttonLabel,
    );
    setMessage(
      root,
      started
        ? `Rerunning “${artifact.title}” with ${loaded.papers.length} source${loaded.papers.length === 1 ? "" : "s"}.${plan.note ? ` ${plan.note}` : ""}`
        : `Sources are ready. Choose ${plan.buttonLabel} in the analysis panel.`,
      started ? "info" : "warning",
    );
  };

  /** Adds the Zotero selection (read once) and opens the tools with it. */
  const addSelection = async () => {
    if (isResearchWorkspaceOwnerActive({ kind: "project", projectID }))
      throw new Error("Finish or cancel the active project analysis first.");
    // Always the window's current selection. Papers read for an earlier
    // selection are never added in its place.
    const selection = selectionWithPapers(root);
    if (!selection)
      throw new Error(
        "Select papers in the Zotero library, then choose Use Zotero selection.",
      );
    const loaded = await loadSelectionPapers(selection, (text) =>
      setMessage(root, text),
    );
    setMessage(root, "Adding the selected papers…");
    await addPapersToResearchWorkspaceProject(projectID, loaded.papers);
    const refreshed = await loadResearchWorkspaceProject(projectID);
    const papers = loaded.papers.filter((paper) =>
      refreshed.members.some(
        (member) =>
          member.sourceID === paper.sourceID &&
          !isResearchWorkspaceMemberExcluded(member),
      ),
    );
    await activate(papers, SELECTION_SCOPE_LABEL);
    // New members change the revisions and the member lists. The
    // re-render keeps the analysis area for the same project.
    await refreshResearchWorkspaceProject(root);
    setMessage(
      root,
      `${addedPapersMessage("Added", loaded.papers.length, loaded.unread)} The analysis tools below use them.`,
      loaded.unread ? "warning" : "success",
    );
  };

  // Analyze: choose papers, then the analysis tools.
  const scope = renderAnalysisScope(doc, root, details, {
    projectID,
    activate,
    addSelection,
  });

  // Papers: bring papers in, track reading, and screen them.
  panels.papers.append(
    renderAddFromZotero(doc, root, details, addSelection),
    renderProjectPapers(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
    renderScreeningLog(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
    renderProjectCandidateInbox(doc, root, details, () =>
      renderProject(root, projectID, capturedPapers, generation),
    ),
  );
  // Results: every saved analysis.
  panels.results.append(
    renderArtifactHistory(doc, root, details, { onRerun: rerunArtifact }),
  );
  // Checks: reviews that read saved results and Zotero metadata.
  panels.checks.append(
    renderContradictionGapPanel(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
    renderCitationHealthPanel(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
    renderLivingReviewPanel(
      doc,
      root,
      details,
      changeInboxResult.inbox,
      capturedPapers,
      generation,
      navigation,
      changeInboxResult.warning,
    ),
  );
  // Settings: the project itself, its template, and Zotero writes.
  panels.settings.append(
    renderProjectSettings(doc, root, details, capturedPapers, generation),
  );
  const templateSettings = renderProjectTemplateSettings(
    doc,
    root,
    details,
    capturedPapers,
    generation,
    navigation,
  );
  if (templateSettings) panels.settings.append(templateSettings);
  panels.settings.append(
    renderSafeZoteroSyncPanel(
      doc,
      root,
      details,
      syncReceiptResult.receipts,
      capturedPapers,
      generation,
      syncReceiptResult.warning,
      navigation,
    ),
  );

  trackDirtyInputs(root);
  const surfaceState = sameProject
    ? captureSurfaceState(root, previousOperations ?? operations)
    : undefined;
  // A kept analysis area stays in its panel, so a running tool keeps its
  // focus and output. Everything around it is replaced.
  const keptPanel = keepOperations
    ? operations.parentElement?.closest<HTMLElement>(".pprw-project-tabpanel")
    : undefined;
  const analyze =
    keptPanel?.parentElement === root
      ? keptPanel
      : renderProjectTabPanel(doc, suffix, "analyze");
  for (const child of Array.from(analyze.children)) {
    if (child !== operations) child.remove();
  }
  analyze.insertBefore(scope.section, analyze.firstChild);
  if (operations.parentElement !== analyze) analyze.append(operations);
  for (const child of Array.from(root.children)) {
    if (child !== analyze) child.remove();
  }
  root.insertBefore(before, analyze.parentElement === root ? analyze : null);
  if (analyze.parentElement !== root) root.append(analyze);
  root.append(panels.papers, panels.results, panels.checks, panels.settings);
  showProjectTab(root, tab);
  if (surfaceState) restoreSurfaceState(root, operations, surfaceState);
  scope.sync();
  if (options.message)
    setMessage(root, options.message.text, options.message.kind);
  if (options.analyze) {
    // Papers excluded in screening stay out of the analysis.
    const included = new Set(
      details.members
        .filter((member) => !isResearchWorkspaceMemberExcluded(member))
        .map((member) => member.sourceID),
    );
    const papers = options.analyze.papers.filter((paper) =>
      included.has(paper.sourceID),
    );
    if (papers.length) await activate(papers, options.analyze.scopeLabel);
  }
}

/** The Analyze tab's paper choice and the action that opens the tools. */
function renderAnalysisScope(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  actions: {
    projectID: string;
    activate: (
      papers: readonly ResearchWorkspacePaper[],
      scopeLabel: string,
    ) => Promise<boolean>;
    addSelection: () => Promise<void>;
  },
) {
  const { projectID, activate } = actions;
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-analyze-scope",
  );
  const heading = element(doc, "div", "pprw-panel-heading");
  const count = element(doc, "p", "pprw-muted pprw-scope-count");
  heading.append(element(doc, "h3", "", "Choose papers to analyze"), count);
  section.append(heading);
  const selection: ResearchWorkspaceSurfaceSelection | undefined =
    selectionWithPapers(root);
  if (!details.members.length) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "This project has no papers yet. Add papers from the Zotero library to analyze them.",
      ),
    );
    if (selection)
      section.append(
        button(
          doc,
          `Add the ${papersLabel(selection.titles.length)} selected in Zotero`,
          actions.addSelection,
          true,
        ),
      );
    else
      section.append(
        element(
          doc,
          "p",
          "pprw-muted",
          "Select papers in the Zotero library, then choose Use Zotero selection at the top of this window.",
        ),
      );
    return { section, sync: () => undefined };
  }
  const list = element(doc, "div", "pprw-scope-list");
  const checks: Array<{ sourceID: string; input: HTMLInputElement }> = [];
  let defaults = 0;
  for (const member of details.members) {
    const source = details.sources.find(
      (entry) => entry.sourceID === member.sourceID,
    );
    const label = element(doc, "label", "pprw-scope-item");
    const input = element(doc, "input", "");
    input.type = "checkbox";
    input.disabled = isResearchWorkspaceMemberExcluded(member);
    input.checked = !input.disabled && defaults++ < ANALYSIS_BATCH_LIMIT;
    input.setAttribute(
      "aria-label",
      `Analyze ${source?.title ?? member.sourceID}`,
    );
    input.dataset.restoreKey = `scope:${member.sourceID}`;
    const state = input.disabled
      ? "excluded in screening"
      : source?.availability === "ready"
        ? ""
        : (source?.availability ?? "unavailable");
    label.append(
      input,
      element(doc, "span", "", source?.title ?? member.sourceID),
    );
    if (state) label.append(element(doc, "span", "pprw-muted", state));
    list.append(label);
    checks.push({ sourceID: member.sourceID, input });
  }
  const selected = () => checks.filter((entry) => entry.input.checked);
  const sync = () => {
    const chosen = selected().length;
    count.textContent = `${chosen} of ${checks.length} selected. Up to ${ANALYSIS_BATCH_LIMIT} at a time.`;
  };
  list.addEventListener("change", sync);
  const choices = element(doc, "div", "pprw-row pprw-scope-choices");
  const setAll = (checked: boolean) => {
    let enabled = 0;
    for (const entry of checks) {
      if (entry.input.disabled) continue;
      entry.input.checked = checked && enabled++ < ANALYSIS_BATCH_LIMIT;
      entry.input.dataset.dirty = "true";
    }
    sync();
  };
  choices.append(
    plainButton(
      doc,
      "Select all",
      () => setAll(true),
      "pprw-button pp-btn pp-btn--ghost",
    ),
    plainButton(
      doc,
      "Clear",
      () => setAll(false),
      "pprw-button pp-btn pp-btn--ghost",
    ),
  );
  const run = element(doc, "div", "pprw-row pprw-scope-actions");
  run.append(
    button(
      doc,
      "Open analysis tools",
      async () => {
        if (isResearchWorkspaceOwnerActive({ kind: "project", projectID }))
          throw new Error(
            "Finish or cancel the active project analysis before changing its scope.",
          );
        const sourceIDs = selected().map((entry) => entry.sourceID);
        if (!sourceIDs.length)
          throw new Error("Select one or more papers to analyze.");
        if (sourceIDs.length > ANALYSIS_BATCH_LIMIT)
          throw new Error(
            `Select up to ${ANALYSIS_BATCH_LIMIT} papers for one analysis.`,
          );
        setMessage(
          root,
          `Reading ${papersLabel(sourceIDs.length)} on this computer…`,
        );
        const loaded = await loadResearchWorkspaceProjectPapers(
          projectID,
          sourceIDs,
        );
        if (!(await activate(loaded.papers, "Selected project papers"))) return;
        setMessage(
          root,
          `${papersLabel(loaded.papers.length)} ready. Pick a tool below.${loaded.skipped.length ? ` Left out: ${loaded.skipped.join("; ")}` : ""}`,
          loaded.skipped.length ? "warning" : "success",
        );
      },
      true,
    ),
  );
  const members = new Set(details.members.map((member) => member.sourceID));
  if (selection) {
    const inProject = selection.sourceIDs.every((sourceID) =>
      members.has(sourceID),
    );
    run.append(
      button(
        doc,
        inProject
          ? `Analyze the Zotero selection (${selection.titles.length})`
          : `Add and analyze the Zotero selection (${selection.titles.length})`,
        actions.addSelection,
      ),
    );
  }
  section.append(list, choices, run);
  if (details.project.comparisonQuestions?.length) {
    section.append(element(doc, "h4", "", "Comparison questions from chat"));
    for (const question of details.project.comparisonQuestions)
      section.append(
        element(
          doc,
          "p",
          "pprw-muted",
          `${question.question} · conversation ${question.provenance.sessionID}, message ${question.provenance.messageID}`,
        ),
      );
  }
  return { section, sync };
}

export async function renderResearchWorkspaceProjectSurface(
  root: HTMLElement,
  options: {
    capturedPapers?: readonly ResearchWorkspacePaper[];
    selection?: ResearchWorkspaceSurfaceSelection;
    /** The project the reader came from, offered first for adding. */
    preferredProjectID?: string;
  } = {},
) {
  if (!releaseOperations(root, "Opening all projects")) return;
  projectContexts.delete(root);
  root.dataset.researchWorkspaceProjectSurface = "true";
  // The home forms hold typed text too, so a relaunch must see it.
  trackDirtyInputs(root);
  if (options.selection) surfaceSelections.set(root, options.selection);
  const selection = surfaceSelections.get(root);
  const generation = Symbol("project-surface");
  generations.set(root, generation);
  // Read papers belong to the current selection only, so a project opened
  // from here cannot carry papers of a replaced selection.
  const capturedPapers = selection
    ? (selection.loaded()?.papers ?? [])
    : (options.capturedPapers ?? []);
  const doc = root.ownerDocument;
  root.replaceChildren(
    element(doc, "div", "pprw-window-loading", "Loading projects…"),
  );
  try {
    const [home, projectsWithSelection] = await Promise.all([
      loadResearchWorkspaceHome(),
      // Projects that already hold the whole selection are offered first,
      // so the same papers do not become a duplicate project.
      selection?.sourceIDs.length
        ? findResearchWorkspaceProjectsWithSources(selection.sourceIDs)
        : Promise.resolve([]),
    ]);
    if (!isCurrent(root, generation)) return;
    root.replaceChildren(
      ...renderProjectHome({
        root,
        home,
        generation,
        navigation,
        selection,
        capturedPapers,
        projectsWithSelection,
        preferredProjectID: options.preferredProjectID,
      }),
    );
  } catch (error) {
    if (!isCurrent(root, generation)) return;
    logProjectError(error);
    root.replaceChildren(
      element(
        doc,
        "div",
        "pprw-window-error",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

/** Names the project open on this surface, if any. */
export function getResearchWorkspaceSurfaceProject(
  root: HTMLElement,
): { projectID: string; projectName: string } | undefined {
  const context = projectContexts.get(root);
  return context
    ? { projectID: context.projectID, projectName: context.projectName }
    : undefined;
}

/** Re-renders the open project in place, keeping the analysis area. */
export async function refreshResearchWorkspaceProject(root: HTMLElement) {
  const context = projectContexts.get(root);
  if (!context) return;
  await renderProject(
    root,
    context.projectID,
    context.capturedPapers,
    generations.get(root) ?? Symbol("project-refresh"),
  );
}

export function disposeResearchWorkspaceProjectSurface(root: HTMLElement) {
  disposeOperations(root);
  generations.delete(root);
  projectContexts.delete(root);
}
