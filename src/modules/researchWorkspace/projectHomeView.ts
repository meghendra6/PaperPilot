import { openStudio } from "../studio/window";
import { element } from "./dom";
import {
  addPapersToResearchWorkspaceProject,
  createResearchWorkspaceProject,
  restoreResearchWorkspaceProject,
} from "./facade";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceProjectHome } from "./projectController";
import { projectDeleteButton } from "./projectDeleteAction";
import {
  addedPapersMessage,
  button,
  formStatus,
  labeledField,
  loadSelectionPapers,
  setMessage,
  textInput,
  type ProjectNavigation,
} from "./projectSurfaceShared";
import { renderProjectTemplateCreator } from "./projectTemplatePanels";
import {
  defaultResearchWorkspaceProjectName,
  describeResearchWorkspaceSkip,
  formatResearchWorkspaceDay,
  papersLabel,
  summarizeResearchWorkspaceSelection,
  type ResearchWorkspaceSurfaceSelection,
} from "./surfaceSelection";

export interface ProjectHomeContext {
  root: HTMLElement;
  home: ResearchWorkspaceProjectHome;
  generation: symbol;
  navigation: ProjectNavigation;
  /** The Zotero selection the window was opened with, if any. */
  selection?: ResearchWorkspaceSurfaceSelection;
  /** Papers that are already read, from an earlier action. */
  capturedPapers: readonly ResearchWorkspacePaper[];
  /** Active projects that already hold the whole selection. */
  projectsWithSelection: readonly ResearchWorkspaceProjectHome["projects"][number][];
  /** The project the reader came from, offered first for adding. */
  preferredProjectID?: string;
}

const SELECTION_SCOPE_LABEL = "Zotero selection";

/** Reads the selection, or returns no papers when there is none. */
async function selectedPapers(
  context: ProjectHomeContext,
  report: (message: string) => void,
): Promise<{ papers: readonly ResearchWorkspacePaper[]; unread: number }> {
  const selection = context.selection;
  if (!selection?.titles.length) return { papers: [], unread: 0 };
  return loadSelectionPapers(selection, report);
}

/** Opens a project and, when papers were read, its analysis tools. */
async function openWithPapers(
  context: ProjectHomeContext,
  projectID: string,
  papers: readonly ResearchWorkspacePaper[],
  message: { text: string; kind: "info" | "success" | "warning" },
) {
  await context.navigation.renderProject(
    context.root,
    projectID,
    papers,
    context.generation,
    {
      analyze: papers.length
        ? { papers, scopeLabel: SELECTION_SCOPE_LABEL }
        : undefined,
      message,
    },
  );
}

function renderGuideSteps(doc: Document) {
  const steps = element(doc, "ol", "pprw-guide-steps");
  for (const [title, text] of [
    [
      "Collect papers.",
      "In the Zotero library, select up to 12 papers that have PDFs. Right-click them and choose Open Research Workspace…, or choose Use Zotero selection at the top of this window.",
    ],
    [
      "Create a project.",
      "A project keeps its papers, analyses, and results together. You can add more papers later.",
    ],
    [
      "Analyze.",
      "Compare the papers, build an Evidence Matrix, or audit methods. Results link to the PDF page they came from and are saved in the project.",
    ],
    [
      "Write.",
      "Choose Open Studio in a project to draft a review, cite your Zotero papers, run notebooks, and ask the assistant.",
    ],
  ]) {
    const step = element(doc, "li", "");
    step.append(element(doc, "strong", "", title), ` ${text}`);
    steps.append(step);
  }
  return steps;
}

/** The first-run guide, or a collapsed reminder once projects exist. */
function renderGuide(doc: Document, collapsed: boolean) {
  if (collapsed) {
    const guide = element(doc, "details", "pprw-project-panel pprw-guide");
    guide.append(
      element(
        doc,
        "summary",
        "pprw-section-title",
        "How Research Workspace works",
      ),
      renderGuideSteps(doc),
    );
    return guide;
  }
  const guide = element(doc, "section", "pprw-project-panel pprw-guide");
  guide.append(
    element(doc, "h2", "", "How Research Workspace works"),
    renderGuideSteps(doc),
  );
  return guide;
}

function renderSkippedList(
  doc: Document,
  selection: ResearchWorkspaceSurfaceSelection,
  open: boolean,
) {
  const summary = summarizeResearchWorkspaceSelection(selection);
  const skipped = element(doc, "details", "pprw-selection-skipped");
  skipped.open = open;
  skipped.append(element(doc, "summary", "", summary.skippedLine));
  const list = element(doc, "ul", "pprw-capture-list");
  for (const entry of selection.skipped) {
    const item = element(doc, "li", "pprw-capture-list-item");
    item.append(
      element(doc, "strong", "", entry.title),
      element(doc, "span", "", describeResearchWorkspaceSkip(entry.code)),
    );
    item.title = entry.reason;
    list.append(item);
  }
  skipped.append(list);
  return skipped;
}

function renderSelectionTitles(
  doc: Document,
  selection: ResearchWorkspaceSurfaceSelection,
) {
  const summary = summarizeResearchWorkspaceSelection(selection);
  const titles = element(doc, "ul", "pprw-selection-titles");
  for (const title of summary.visibleTitles) {
    const item = element(doc, "li", "");
    item.append(element(doc, "span", "pprw-selection-title", title));
    titles.append(item);
  }
  if (summary.hiddenCount) {
    titles.append(
      element(doc, "li", "pprw-muted", `and ${summary.hiddenCount} more`),
    );
  }
  return titles;
}

function renderCreateFromSelection(
  context: ProjectHomeContext,
  selection: ResearchWorkspaceSurfaceSelection,
  primary: boolean,
) {
  const doc = context.root.ownerDocument;
  const count = selection.titles.length;
  const option = element(doc, "div", "pprw-start-option");
  const name = textInput(
    doc,
    "Project name",
    defaultResearchWorkspaceProjectName(selection.titles, new Date()),
  );
  const question = textInput(doc, "Research question (optional)", "");
  question.placeholder = "For example: How reliable are LLM judges?";
  const status = formStatus(doc);
  const create = button(
    doc,
    `Create project with ${papersLabel(count)}`,
    async () => {
      status.clear();
      try {
        const loaded = await selectedPapers(context, status.info);
        status.info("Creating the project…");
        const created = await createResearchWorkspaceProject({
          name: name.value,
          researchQuestion: question.value || undefined,
          papers: loaded.papers,
        });
        await openWithPapers(
          context,
          created.project.projectID,
          loaded.papers,
          {
            text: `${addedPapersMessage(
              `Created “${created.project.name}” with`,
              loaded.papers.length,
              loaded.unread,
            )} Pick an analysis below.`,
            kind: loaded.unread ? "warning" : "success",
          },
        );
      } catch (error) {
        status.error(error);
      }
    },
    primary,
  );
  option.append(
    element(doc, "h3", "", primary ? "New project" : "Another project"),
    labeledField(doc, "Project name", name),
    labeledField(
      doc,
      "Research question",
      question,
      "Optional. Analyses can use it.",
    ),
    create,
    status.node,
  );
  return option;
}

function renderAddSelectionToProject(
  context: ProjectHomeContext,
  selection: ResearchWorkspaceSurfaceSelection,
) {
  const doc = context.root.ownerDocument;
  const option = element(doc, "div", "pprw-start-option");
  const choice = element(doc, "select", "pprw-input");
  choice.setAttribute("aria-label", "Project to add the papers to");
  const projects = addableProjects(context);
  for (const project of projects) {
    const entry = element(doc, "option", "", project.name);
    entry.value = project.projectID;
    choice.append(entry);
  }
  // The project the reader came from is the likely destination.
  const preferred = projects.find(
    (project) => project.projectID === context.preferredProjectID,
  );
  if (preferred) choice.value = preferred.projectID;
  const status = formStatus(doc);
  option.append(
    element(doc, "h3", "", "Add to a project"),
    labeledField(doc, "Project", choice),
    button(doc, `Add ${papersLabel(selection.titles.length)}`, async () => {
      status.clear();
      const project = projects.find(
        (entry) => entry.projectID === choice.value,
      );
      if (!project) return;
      try {
        await addSelectionAndOpen(context, project, status.info);
      } catch (error) {
        status.error(error);
      }
    }),
    status.node,
  );
  return option;
}

async function addSelectionAndOpen(
  context: ProjectHomeContext,
  project: { projectID: string; name: string },
  report: (message: string) => void,
) {
  const loaded = await selectedPapers(context, report);
  report(`Adding the papers to “${project.name}”…`);
  await addPapersToResearchWorkspaceProject(project.projectID, loaded.papers);
  await openWithPapers(context, project.projectID, loaded.papers, {
    text: `${addedPapersMessage(
      `Added to “${project.name}”:`,
      loaded.papers.length,
      loaded.unread,
    )} The analysis tools below use these papers.`,
    kind: loaded.unread ? "warning" : "success",
  });
}

/** Projects that do not hold the whole selection yet. */
function addableProjects(context: ProjectHomeContext) {
  const holding = new Set(
    context.projectsWithSelection.map((project) => project.projectID),
  );
  return context.home.projects.filter(
    (project) => !holding.has(project.projectID),
  );
}

/** Projects that already hold the selection, each with an Open action. */
function renderExistingProjects(
  context: ProjectHomeContext,
  selection: ResearchWorkspaceSurfaceSelection,
) {
  const doc = context.root.ownerDocument;
  const existing = element(doc, "div", "pprw-start-existing");
  const count = selection.titles.length;
  existing.append(
    element(
      doc,
      "p",
      "",
      count === 1
        ? "This paper is already in:"
        : `These ${count} papers are already in:`,
    ),
  );
  const status = formStatus(doc);
  const list = element(doc, "ul", "pprw-start-existing-list");
  for (const project of context.projectsWithSelection.slice(0, 3)) {
    const item = element(doc, "li", "");
    const name = element(doc, "strong", "", project.name);
    name.title = project.name;
    const open = button(
      doc,
      "Open",
      async () => {
        status.clear();
        try {
          const loaded = await selectedPapers(context, status.info);
          await openWithPapers(context, project.projectID, loaded.papers, {
            text: `Opened “${project.name}”. The analysis tools below use the ${papersLabel(loaded.papers.length)} you selected.`,
            kind: "success",
          });
        } catch (error) {
          status.error(error);
        }
      },
      true,
    );
    open.setAttribute("aria-label", `Open ${project.name}`);
    item.append(name, open);
    list.append(item);
  }
  existing.append(list, status.node);
  return existing;
}

/** The first panel when the window opened with a Zotero selection. */
function renderSelectionStart(
  context: ProjectHomeContext,
  selection: ResearchWorkspaceSurfaceSelection,
) {
  const doc = context.root.ownerDocument;
  const summary = summarizeResearchWorkspaceSelection(selection);
  const count = selection.titles.length;
  const section = element(
    doc,
    "section",
    "pprw-project-panel pprw-start-panel",
  );
  section.setAttribute("aria-label", "Selected in Zotero");
  if (!count) {
    section.classList.add("pprw-start-panel--empty");
    section.append(
      element(doc, "h2", "", summary.headline),
      element(
        doc,
        "p",
        "pprw-muted",
        "Select items that have a PDF attachment in the Zotero library, then choose Use Zotero selection.",
      ),
      renderSkippedList(doc, selection, true),
    );
    return section;
  }
  section.append(
    element(
      doc,
      "h2",
      "",
      count === 1
        ? "Start with the paper selected in Zotero"
        : `Start with the ${count} papers selected in Zotero`,
    ),
    renderSelectionTitles(doc, selection),
  );
  if (selection.skipped.length)
    section.append(renderSkippedList(doc, selection, false));
  const alreadyInProject = context.projectsWithSelection.length > 0;
  if (alreadyInProject)
    section.append(renderExistingProjects(context, selection));
  const options = element(doc, "div", "pprw-start-options");
  options.append(
    renderCreateFromSelection(context, selection, !alreadyInProject),
  );
  if (addableProjects(context).length)
    options.append(renderAddSelectionToProject(context, selection));
  section.append(
    options,
    element(
      doc,
      "p",
      "pprw-muted pprw-start-note",
      "Paper Pilot reads the PDFs on this computer when you create or add. No model runs until you choose an analysis.",
    ),
  );
  return section;
}

function projectCardDetails(
  project: ResearchWorkspaceProjectHome["projects"][number],
) {
  const parts = [
    papersLabel(project.memberCount),
    `updated ${formatResearchWorkspaceDay(project.updatedAt)}`,
  ];
  if (project.staleArtifactCount)
    parts.push(
      `${project.staleArtifactCount} result${project.staleArtifactCount === 1 ? " needs" : "s need"} a rerun`,
    );
  if (project.dueMasteryReviewCount)
    parts.push(
      `${project.dueMasteryReviewCount} Mastery review${project.dueMasteryReviewCount === 1 ? "" : "s"} due`,
    );
  return parts.join(", ");
}

function homeSummary(home: ResearchWorkspaceProjectHome) {
  const parts = [
    `${home.projects.length} project${home.projects.length === 1 ? "" : "s"}`,
  ];
  if (home.dueMasteryReviews)
    parts.push(
      `${home.dueMasteryReviews} Mastery review${home.dueMasteryReviews === 1 ? "" : "s"} due`,
    );
  if (home.staleArtifacts)
    parts.push(
      `${home.staleArtifacts} result${home.staleArtifacts === 1 ? " needs" : "s need"} a rerun`,
    );
  return parts.join(", ");
}

function renderProjectCards(context: ProjectHomeContext) {
  const doc = context.root.ownerDocument;
  const { home, root, generation, capturedPapers } = context;
  const section = element(doc, "section", "pprw-project-panel");
  const heading = element(doc, "div", "pprw-panel-heading");
  heading.append(
    element(doc, "h2", "", "Your projects"),
    element(doc, "p", "pprw-muted", homeSummary(home)),
  );
  section.append(heading);
  const grid = element(doc, "div", "pprw-project-grid");
  for (const project of home.projects) {
    const card = element(doc, "article", "pprw-project-card");
    const title = element(doc, "h3", "", project.name);
    title.title = project.name;
    card.append(
      title,
      element(doc, "p", "pprw-muted", projectCardDetails(project)),
    );
    const actions = element(doc, "div", "pprw-row");
    const open = button(
      doc,
      "Open",
      () =>
        context.navigation.renderProject(
          root,
          project.projectID,
          capturedPapers,
          generation,
        ),
      true,
    );
    open.setAttribute("aria-label", `Open ${project.name}`);
    const studio = button(doc, "Open Studio", () =>
      openStudio(project.projectID),
    );
    studio.setAttribute("aria-label", `Open Studio for ${project.name}`);
    studio.title =
      "Write drafts, cite papers, and run notebooks for this project.";
    actions.append(
      open,
      studio,
      projectDeleteButton(root, project, () =>
        context.navigation.renderHome(root, { capturedPapers }),
      ),
    );
    card.append(actions);
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function renderNewProject(context: ProjectHomeContext) {
  const doc = context.root.ownerDocument;
  const section = element(doc, "section", "pprw-project-panel");
  const name = textInput(doc, "Project name");
  const question = textInput(doc, "Research question (optional)");
  question.placeholder = "For example: How reliable are LLM judges?";
  const status = formStatus(doc);
  section.append(
    element(doc, "h2", "", "New project"),
    element(
      doc,
      "p",
      "pprw-muted",
      "To start with papers, select them in the Zotero library and choose Use Zotero selection. You can also add papers to an empty project later.",
    ),
    labeledField(doc, "Project name", name),
    labeledField(
      doc,
      "Research question",
      question,
      "Optional. Analyses can use it.",
    ),
    button(
      doc,
      "Create empty project",
      async () => {
        status.clear();
        try {
          const created = await createResearchWorkspaceProject({
            name: name.value,
            researchQuestion: question.value || undefined,
          });
          await openWithPapers(context, created.project.projectID, [], {
            text: `Created “${created.project.name}”. Add papers from the Papers tab.`,
            kind: "success",
          });
        } catch (error) {
          status.error(error);
        }
      },
      true,
    ),
    status.node,
  );
  return section;
}

function renderTemplates(context: ProjectHomeContext) {
  return renderProjectTemplateCreator(context.root.ownerDocument, {
    includedPapers: context.selection?.titles.length ?? 0,
    papers: (report) => selectedPapers(context, report),
    open: (projectID, papers, message) =>
      openWithPapers(context, projectID, papers, message),
  });
}

function renderArchivedProjects(context: ProjectHomeContext) {
  const doc = context.root.ownerDocument;
  const { home, root, generation, capturedPapers } = context;
  const archived = element(doc, "details", "pprw-project-panel");
  archived.append(
    element(
      doc,
      "summary",
      "pprw-section-title",
      `Archived projects (${home.archivedProjects.length})`,
    ),
  );
  const list = element(doc, "ul", "pprw-capture-list pprw-archived-list");
  for (const project of home.archivedProjects) {
    const item = element(doc, "li", "pprw-archived-project");
    item.append(
      element(
        doc,
        "span",
        "",
        `${project.name}${project.archivedAt ? `, archived ${formatResearchWorkspaceDay(project.archivedAt)}` : ""}`,
      ),
      button(doc, "Open", () =>
        context.navigation.renderProject(
          root,
          project.projectID,
          capturedPapers,
          generation,
        ),
      ),
      button(doc, "Restore", async () => {
        await restoreResearchWorkspaceProject(project.projectID);
        await context.navigation.renderHome(root, { capturedPapers });
        setMessage(
          root,
          `Restored “${project.name}” to Your projects.`,
          "success",
        );
      }),
      projectDeleteButton(root, project, () =>
        context.navigation.renderHome(root, { capturedPapers }),
      ),
    );
    list.append(item);
  }
  archived.append(list);
  return archived;
}

/**
 * The window home. A Zotero selection comes first with one-step actions.
 * Otherwise the reader's projects come first, then a new project form.
 */
export function renderProjectHome(context: ProjectHomeContext): Node[] {
  const { home, selection } = context;
  const hasProjects = home.projects.length > 0;
  const nodes: Node[] = [];
  const startsWithSelection = Boolean(selection?.titles.length);
  if (selection && (selection.titles.length || selection.skipped.length))
    nodes.push(renderSelectionStart(context, selection));
  if (!hasProjects && !startsWithSelection)
    nodes.push(renderGuide(context.root.ownerDocument, false));
  if (hasProjects) nodes.push(renderProjectCards(context));
  if (!startsWithSelection) nodes.push(renderNewProject(context));
  nodes.push(renderTemplates(context));
  if (hasProjects || startsWithSelection)
    nodes.push(renderGuide(context.root.ownerDocument, true));
  if (home.archivedProjects.length) nodes.push(renderArchivedProjects(context));
  return nodes;
}
