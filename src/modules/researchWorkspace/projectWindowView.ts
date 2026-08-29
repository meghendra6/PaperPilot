import {
  addPapersToResearchWorkspaceProject,
  archiveResearchWorkspaceProject,
  createResearchWorkspaceProject,
  deleteResearchWorkspaceProject,
  exportIntegratedResearchWorkspace,
  loadResearchWorkspaceHome,
  loadResearchWorkspaceProject,
  updateResearchWorkspaceMember,
  updateResearchWorkspaceProject,
} from "./facade";
import { renderResearchWorkspaceArtifactEnvelope } from "./artifactRenderer";
import { openVerifiedResearchWorkspaceEvidence } from "./evidenceNavigation";
import type { EvidenceReferenceV2 } from "./evidenceVerification";
import { readResearchWorkspaceArtifact } from "./legacyCapabilityAdapters";
import type { ResearchWorkspacePaper } from "./paperSource";
import type {
  ResearchWorkspaceProjectDetails,
  ResearchWorkspaceProjectHome,
} from "./projectController";
import {
  disposeResearchWorkspaceView,
  renderResearchWorkspaceView,
} from "./view";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const generations = new WeakMap<HTMLElement, symbol>();
const activeOperationRoots = new WeakMap<HTMLElement, HTMLElement>();

function disposeOperations(root: HTMLElement) {
  const operations = activeOperationRoots.get(root);
  if (operations) disposeResearchWorkspaceView(operations);
  activeOperationRoots.delete(root);
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = "",
  text?: string,
) {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  doc: Document,
  label: string,
  action: () => void | Promise<void>,
  primary = false,
) {
  const node = element(
    doc,
    "button",
    `pprw-button pp-btn ${primary ? "pp-btn--primary" : "pp-btn--secondary"}`,
    label,
  );
  node.type = "button";
  node.addEventListener("click", () => void action());
  return node;
}

function textInput(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "input", "pprw-input");
  node.type = "text";
  node.placeholder = placeholder;
  node.value = value;
  return node;
}

function setMessage(root: HTMLElement, message: string, kind = "info") {
  const node = root.querySelector<HTMLElement>("[data-project-message]");
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
}

function isCurrent(root: HTMLElement, generation: symbol) {
  return generations.get(root) === generation;
}

function metric(doc: Document, value: number, label: string) {
  const node = element(doc, "div", "pprw-home-metric");
  node.append(
    element(doc, "strong", "", value.toLocaleString()),
    element(doc, "span", "", label),
  );
  return node;
}

function renderSelectionReview(
  doc: Document,
  papers: readonly ResearchWorkspacePaper[],
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(
    element(doc, "h2", "", "Review captured selection"),
    element(
      doc,
      "p",
      "pprw-muted",
      `${papers.length} exact PDF${papers.length === 1 ? " is" : "s are"} ready. No analysis starts until you choose a project and an operation.`,
    ),
  );
  const list = element(doc, "div", "pprw-project-paper-list");
  for (const paper of papers) {
    const row = element(doc, "div", "pprw-project-paper-row");
    row.append(
      element(doc, "strong", "", paper.title),
      element(
        doc,
        "span",
        "pprw-muted",
        `Library ${paper.libraryID} · PDF ${paper.attachmentKey} · ${paper.extractionQuality}`,
      ),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

async function renderProject(
  root: HTMLElement,
  projectID: string,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const details = await loadResearchWorkspaceProject(projectID);
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
    renderProjectPapers(doc, root, details, capturedPapers, generation),
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

function renderProjectPapers(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(element(doc, "h3", "", `Papers · ${details.members.length}`));
  if (!details.members.length) {
    section.append(
      element(doc, "p", "pprw-muted", "This project has no papers yet."),
    );
    return section;
  }
  const sourceByID = new Map(
    details.sources.map((source) => [source.sourceID, source]),
  );
  const list = element(doc, "div", "pprw-project-paper-list");
  for (const member of details.members) {
    const source = sourceByID.get(member.sourceID);
    const row = element(doc, "div", "pprw-project-paper-row");
    const label = element(doc, "div", "pprw-project-paper-label");
    label.append(
      element(doc, "strong", "", source?.title ?? member.sourceID),
      element(
        doc,
        "span",
        "pprw-muted",
        `${source?.availability ?? "missing"} · ${source?.identity.attachmentKey ?? "detached"}`,
      ),
    );
    const select = element(doc, "select", "pprw-select");
    for (const status of [
      "unreviewed",
      "maybe",
      "up-next",
      "skimmed",
      "read",
      "understood",
      "included",
      "excluded",
    ] as const) {
      const option = element(doc, "option", "", status);
      option.value = status;
      option.selected = member.reviewStatus === status;
      select.append(option);
    }
    select.setAttribute(
      "aria-label",
      `Review status for ${source?.title ?? member.sourceID}`,
    );
    select.addEventListener("change", () => {
      void (async () => {
        let exclusionReason: string | undefined;
        if (select.value === "excluded") {
          exclusionReason =
            doc.defaultView?.prompt(
              "Reason for exclusion",
              member.exclusionReason ?? "",
            ) ?? undefined;
          if (!exclusionReason?.trim()) {
            select.value = member.reviewStatus;
            return;
          }
        }
        try {
          await updateResearchWorkspaceMember({
            projectID: details.project.projectID,
            sourceID: member.sourceID,
            reviewStatus: select.value as any,
            exclusionReason,
          });
          await renderProject(
            root,
            details.project.projectID,
            capturedPapers,
            generation,
          );
        } catch (error) {
          setMessage(
            root,
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      })();
    });
    row.append(label, select);
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderArtifactHistory(
  doc: Document,
  root: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
) {
  const section = element(doc, "section", "pprw-project-panel");
  section.append(
    element(doc, "h3", "", `Artifacts · ${details.artifacts.length}`),
  );
  if (!details.artifacts.length) {
    section.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No artifacts yet. Running an explicit operation creates a versioned artifact and run record.",
      ),
    );
    return section;
  }
  const list = element(doc, "div", "pprw-artifact-history");
  for (const storedArtifact of details.artifacts) {
    const readable = readResearchWorkspaceArtifact(storedArtifact);
    const artifact = readable.artifact;
    const item = element(doc, "details", "pprw-artifact-card");
    const summary = element(doc, "summary", "pprw-artifact-summary");
    summary.append(
      element(doc, "strong", "", artifact.title),
      ...(readable.legacy
        ? [element(doc, "span", "pprw-artifact-status", "legacy · read only")]
        : []),
      element(
        doc,
        "span",
        `pprw-artifact-status pprw-artifact-status--${artifact.status}`,
        `v${artifact.version} · ${artifact.status}`,
      ),
    );
    const meta = element(
      doc,
      "p",
      "pprw-muted",
      `${artifact.sourceIDs.length} source${artifact.sourceIDs.length === 1 ? "" : "s"} · ${new Date(artifact.updatedAt).toLocaleString()}`,
    );
    item.append(summary, meta);
    if (artifact.staleReasons?.length) {
      item.append(
        element(
          doc,
          "p",
          "pprw-project-warning",
          `Stale: ${artifact.staleReasons.join(", ")}`,
        ),
      );
    }
    item.append(
      renderResearchWorkspaceArtifactEnvelope(doc, artifact, {
        onOpenEvidence: async (reference) => {
          try {
            await openVerifiedResearchWorkspaceEvidence(
              reference as unknown as EvidenceReferenceV2,
            );
          } catch (error) {
            setMessage(
              root,
              error instanceof Error ? error.message : String(error),
              "error",
            );
          }
        },
      }),
    );
    list.append(item);
  }
  section.append(list);
  return section;
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

    const create = element(doc, "section", "pprw-project-panel");
    create.append(element(doc, "h2", "", "Create project"));
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
