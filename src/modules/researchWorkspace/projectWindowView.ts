import { element } from "./dom";
import {
  addPapersToResearchWorkspaceProject,
  archiveResearchWorkspaceProject,
  createResearchWorkspaceProject,
  deleteResearchWorkspaceProject,
  exportIntegratedResearchWorkspace,
  listResearchWorkspaceZoteroSyncReceipts,
  loadResearchWorkspaceChangeInbox,
  loadResearchWorkspaceHome,
  loadResearchWorkspaceProject,
  updateResearchWorkspaceProject,
} from "./facade";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceProjectHome } from "./projectController";
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
  button,
  disposeOperations,
  generations,
  isCurrent,
  logProjectError,
  metric,
  setMessage,
  textInput,
} from "./projectSurfaceShared";
import { renderSafeZoteroSyncPanel } from "./projectSyncPanel";
import {
  renderProjectTemplateCreator,
  renderProjectTemplateSettings,
  renderSelectionReview,
} from "./projectTemplatePanels";
import { renderResearchWorkspaceView } from "./view";
import type { ResearchWorkspaceZoteroSyncReceiptFile } from "./zoteroSync";
const navigation = {
  renderProject,
  renderHome: renderResearchWorkspaceProjectSurface,
};
async function renderProject(
  root: HTMLElement,
  projectID: string,
  capturedPapers: readonly ResearchWorkspacePaper[],
  _parentGeneration: symbol,
) {
  const generation = Symbol("project-render");
  generations.set(root, generation);
  const [details, changeInbox, syncReceiptResult] = await Promise.all([
    loadResearchWorkspaceProject(projectID),
    loadResearchWorkspaceChangeInbox(projectID),
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
  disposeOperations(root);
  root.replaceChildren();

  const toolbar = element(doc, "div", "pprw-project-toolbar");
  toolbar.append(
    button(doc, "All projects", () =>
      renderResearchWorkspaceProjectSurface(root, { capturedPapers }),
    ),
    element(doc, "h2", "", details.project.name),
  );
  root.append(toolbar);

  const message = element(doc, "div", "pprw-status", "Project ready.");
  message.dataset.projectMessage = "true";
  message.dataset.kind = "success";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  root.append(message);

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
        setMessage(
          root,
          `Exported to ${result.jsonPath} and ${result.markdownPath}.`,
          "success",
        );
      } catch (error) {
        setMessage(
          root,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    }),
    button(doc, "Archive", async () => {
      await archiveResearchWorkspaceProject(projectID);
      await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
    }),
    button(doc, "Delete", async () => {
      const confirmed =
        doc.defaultView?.confirm(
          `Delete “${details.project.name}” and its Paper Pilot artifacts? Zotero items and PDFs will not be deleted.`,
        ) ?? false;
      if (!confirmed) return;
      await deleteResearchWorkspaceProject(projectID);
      await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
    }),
  );
  settings.append(name, question, settingsActions);
  root.append(settings);
  const templateSettings = renderProjectTemplateSettings(
    doc,
    root,
    details,
    capturedPapers,
    generation,
    navigation,
  );
  if (templateSettings) root.append(templateSettings);

  if (capturedPapers.length) {
    const captured = element(doc, "section", "pprw-project-panel");
    captured.append(
      element(doc, "h3", "", "Captured papers"),
      element(
        doc,
        "p",
        "pprw-muted",
        `${capturedPapers.length} paper${capturedPapers.length === 1 ? "" : "s"} from this immutable selection can be analyzed in this project.`,
      ),
      button(
        doc,
        "Add captured papers",
        async () => {
          setMessage(root, "Adding captured papers…");
          await addPapersToResearchWorkspaceProject(projectID, capturedPapers);
          await renderProject(root, projectID, capturedPapers, generation);
        },
        true,
      ),
    );
    root.append(captured);
  }

  root.append(
    renderScreeningLog(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
    renderProjectPapers(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
  );
  root.append(
    renderLivingReviewPanel(
      doc,
      root,
      details,
      changeInbox,
      capturedPapers,
      generation,
      navigation,
    ),
  );
  root.append(
    renderCitationHealthPanel(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
  );
  root.append(
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
  root.append(
    renderContradictionGapPanel(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
  );
  root.append(renderArtifactHistory(doc, root, details));

  if (capturedPapers.length) {
    const operations = element(doc, "section", "pprw-project-operations");
    activeOperationRoots.set(root, operations);
    root.append(operations);
    await renderResearchWorkspaceView(operations, undefined, {
      preloadedPaper: capturedPapers[0],
      capturedPapers,
      standalone: true,
      projectID,
      recommendedCapabilityIDs: details.project.capabilityPresetIDs,
    });
  } else {
    const empty = element(doc, "section", "pprw-project-panel");
    empty.append(
      element(doc, "h3", "", "Run an analysis"),
      element(
        doc,
        "p",
        "pprw-muted",
        "Capture one or more Zotero PDFs with Start a new selection, then open this project and add them.",
      ),
    );
    root.append(empty);
  }
}

function renderHomeCards(
  doc: Document,
  root: HTMLElement,
  home: ResearchWorkspaceProjectHome,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(element(doc, "h2", "", "Recent projects"));
  if (!home.projects.length) {
    section.append(
      element(doc, "p", "pprw-muted", "Create the first research project."),
    );
    return section;
  }
  const grid = element(doc, "div", "pprw-project-grid");
  for (const project of home.projects) {
    const card = element(doc, "article", "pprw-project-card");
    card.append(
      element(doc, "h3", "", project.name),
      element(
        doc,
        "p",
        "pprw-muted",
        `${project.memberCount} papers · ${project.staleArtifactCount} stale · updated ${new Date(project.updatedAt).toLocaleDateString()}`,
      ),
    );
    const actions = element(doc, "div", "pprw-row");
    actions.append(
      button(doc, "Open", () =>
        renderProject(root, project.projectID, capturedPapers, generation),
      ),
    );
    if (capturedPapers.length) {
      actions.append(
        button(
          doc,
          "Add captured papers",
          async () => {
            await addPapersToResearchWorkspaceProject(
              project.projectID,
              capturedPapers,
            );
            await renderProject(
              root,
              project.projectID,
              capturedPapers,
              generation,
            );
          },
          true,
        ),
      );
    }
    card.append(actions);
    grid.append(card);
  }
  section.append(grid);
  return section;
}

export async function renderResearchWorkspaceProjectSurface(
  root: HTMLElement,
  options: { capturedPapers?: readonly ResearchWorkspacePaper[] } = {},
) {
  disposeOperations(root);
  root.dataset.researchWorkspaceProjectSurface = "true";
  const generation = Symbol("project-surface");
  generations.set(root, generation);
  const capturedPapers = options.capturedPapers ?? [];
  const doc = root.ownerDocument;
  root.replaceChildren(
    element(doc, "div", "pprw-window-loading", "Loading projects…"),
  );
  try {
    const home = await loadResearchWorkspaceHome();
    if (!isCurrent(root, generation)) return;
    root.replaceChildren();
    const intro = element(doc, "section", "pprw-home");
    intro.append(
      element(doc, "h2", "", "Workspace home"),
      element(
        doc,
        "p",
        "pprw-muted",
        "Projects retain exact Zotero sources, versioned artifacts, and run history independently of the current selection.",
      ),
    );
    const metrics = element(doc, "div", "pprw-home-metrics");
    metrics.append(
      metric(doc, home.projects.length, "Active projects"),
      metric(doc, home.dueMasteryReviews, "Mastery reviews due"),
      metric(doc, home.staleArtifacts, "Stale artifacts"),
    );
    intro.append(metrics);
    root.append(intro);
    if (capturedPapers.length) {
      root.append(renderSelectionReview(doc, capturedPapers));
    }
    root.append(
      renderProjectTemplateCreator(
        doc,
        root,
        capturedPapers,
        generation,
        navigation,
      ),
    );

    const create = element(doc, "section", "pprw-project-panel");
    create.append(element(doc, "h2", "", "Create blank project"));
    const name = textInput(
      doc,
      "Project name",
      capturedPapers.length
        ? `Research set · ${new Date().toLocaleDateString()}`
        : "",
    );
    const question = textInput(doc, "Research question (optional)");
    create.append(
      name,
      question,
      button(
        doc,
        capturedPapers.length
          ? "Create with captured papers"
          : "Create empty project",
        async () => {
          try {
            const created = await createResearchWorkspaceProject({
              name: name.value,
              researchQuestion: question.value || undefined,
              papers: capturedPapers,
            });
            await renderProject(
              root,
              created.project.projectID,
              capturedPapers,
              generation,
            );
          } catch (error) {
            const message = element(
              doc,
              "p",
              "pprw-project-warning",
              error instanceof Error ? error.message : String(error),
            );
            create.append(message);
            logProjectError(error);
          }
        },
        true,
      ),
    );
    root.append(create);
    root.append(renderHomeCards(doc, root, home, capturedPapers, generation));
    if (home.archivedProjects.length) {
      const archived = element(doc, "details", "pprw-project-panel");
      archived.append(
        element(
          doc,
          "summary",
          "pprw-section-title",
          `Archived projects · ${home.archivedProjects.length}`,
        ),
      );
      const list = element(doc, "ul", "pprw-capture-list");
      for (const project of home.archivedProjects) {
        list.append(element(doc, "li", "", project.name));
      }
      archived.append(list);
      root.append(archived);
    }
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

export function disposeResearchWorkspaceProjectSurface(root: HTMLElement) {
  disposeOperations(root);
  generations.delete(root);
}
