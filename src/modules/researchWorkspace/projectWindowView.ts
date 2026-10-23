import { renderProjectCandidateInbox } from "./projectCandidatePanel";
import { openStudio } from "../studio/window";
import { isResearchWorkspaceMemberExcluded } from "./memberState";
import { isResearchWorkspaceOwnerActive } from "./projectRunAdmission";
import { element } from "./dom";
import { planResearchWorkspaceArtifactRerun } from "./artifactRerun";
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
import type {
  ResearchWorkspaceProjectDetails,
  ResearchWorkspaceProjectHome,
} from "./projectController";
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
  releaseOperations,
  setMessage,
  textInput,
} from "./projectSurfaceShared";
import { renderSafeZoteroSyncPanel } from "./projectSyncPanel";
import {
  renderProjectTemplateCreator,
  renderProjectTemplateSettings,
  renderSelectionReview,
} from "./projectTemplatePanels";
import {
  renderResearchWorkspaceView,
  triggerResearchWorkspaceViewAction,
} from "./view";
import type { ResearchWorkspaceZoteroSyncReceiptFile } from "./zoteroSync";

interface ProjectSurfaceContext {
  projectID: string;
  projectName: string;
  capturedPapers: readonly ResearchWorkspacePaper[];
}

/** The project currently shown on each surface root, for window actions. */
const projectContexts = new WeakMap<HTMLElement, ProjectSurfaceContext>();

const navigation = {
  renderProject,
  renderHome: renderResearchWorkspaceProjectSurface,
};

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
        setMessage(root, "Project restored to Recent projects.", "success");
      },
      true,
    ),
  );
  return notice;
}

async function renderProject(
  root: HTMLElement,
  projectID: string,
  capturedPapers: readonly ResearchWorkspacePaper[],
  _parentGeneration: symbol,
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
  projectContexts.set(root, {
    projectID,
    projectName: details.project.name,
    capturedPapers,
  });
  const content = doc.createDocumentFragment();

  const toolbar = element(doc, "div", "pprw-project-toolbar");
  toolbar.append(
    button(doc, "All projects", () =>
      renderResearchWorkspaceProjectSurface(root, { capturedPapers }),
    ),
    element(doc, "h2", "", details.project.name),
    button(doc, "Write & run", () => openStudio(projectID)),
  );
  content.append(toolbar);

  const message = element(doc, "div", "pprw-status", "Project ready.");
  message.dataset.projectMessage = "true";
  message.dataset.kind = "success";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.tabIndex = -1;
  content.append(message);
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
    content.append(warnings);
  }
  const archived = archiveNotice(
    doc,
    root,
    details,
    capturedPapers,
    generation,
  );
  if (archived) content.append(archived);

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
    button(doc, "Delete", async () => {
      const confirmed =
        doc.defaultView?.confirm(
          `Delete “${details.project.name}” and its Paper Pilot artifacts? Zotero items and PDFs will not be deleted.`,
        ) ?? false;
      if (!confirmed) return;
      if (!releaseOperations(root, "Deleting this project")) return;
      await deleteResearchWorkspaceProject(projectID);
      await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
    }),
  );
  settings.append(name, question, settingsActions);
  content.append(settings);
  const templateSettings = renderProjectTemplateSettings(
    doc,
    root,
    details,
    capturedPapers,
    generation,
    navigation,
  );
  if (templateSettings) content.append(templateSettings);

  content.append(
    renderProjectCandidateInbox(doc, root, details, () =>
      renderProject(root, projectID, capturedPapers, generation),
    ),
  );

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
    content.append(captured);
  }

  content.append(
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
  content.append(
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
  content.append(
    renderCitationHealthPanel(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
  );
  content.append(
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
  content.append(
    renderContradictionGapPanel(
      doc,
      root,
      details,
      capturedPapers,
      generation,
      navigation,
    ),
  );

  const scope = element(doc, "section", "pprw-project-panel");
  scope.append(
    element(doc, "h3", "", "Analysis scope"),
    element(
      doc,
      "p",
      "pprw-muted",
      "Choose up to 12 project sources for this batch. Excluded sources are omitted. Unreviewed or maybe papers are not counted as screening inclusions.",
    ),
  );
  const checks: Array<{ sourceID: string; input: HTMLInputElement }> = [];
  let defaults = 0;
  for (const member of details.members) {
    const source = details.sources.find(
      (entry) => entry.sourceID === member.sourceID,
    );
    const label = element(doc, "label", "pprw-row");
    const input = element(doc, "input", "");
    input.type = "checkbox";
    input.disabled = isResearchWorkspaceMemberExcluded(member);
    input.checked = !input.disabled && defaults++ < 12;
    input.setAttribute(
      "aria-label",
      `Analyze ${source?.title ?? member.sourceID}`,
    );
    label.append(
      input,
      element(
        doc,
        "span",
        "",
        `${source?.title ?? member.sourceID} · ${input.disabled ? "excluded" : (source?.availability ?? "unavailable")}`,
      ),
    );
    scope.append(label);
    checks.push({ sourceID: member.sourceID, input });
  }
  const operations =
    keepOperations && previousOperations
      ? previousOperations
      : element(doc, "section", "pprw-project-operations");
  operations.dataset.projectId = projectID;
  operations.tabIndex = -1;
  operations.setAttribute("aria-label", "Analysis");
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
    // The analysis panel sits below the project panels. Bring it into view
    // and move focus there so keyboard and screen-reader users follow.
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
    if (!(await activate(loaded.papers, `Rerun · ${artifact.title}`))) return;
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
  content.append(
    renderArtifactHistory(doc, root, details, { onRerun: rerunArtifact }),
  );
  scope.append(
    button(
      doc,
      "Prepare selected project papers",
      async () => {
        if (isResearchWorkspaceOwnerActive({ kind: "project", projectID }))
          throw new Error(
            "Finish or cancel the active project analysis before changing its scope.",
          );
        const sourceIDs = checks
          .filter((entry) => entry.input.checked)
          .map((entry) => entry.sourceID);
        if (!sourceIDs.length)
          throw new Error("Select one or more project sources.");
        setMessage(root, "Preparing the selected project PDFs…");
        const loaded = await loadResearchWorkspaceProjectPapers(
          projectID,
          sourceIDs,
        );
        if (!(await activate(loaded.papers, "Selected project papers"))) return;
        setMessage(
          root,
          `${loaded.papers.length} exact PDFs ready in the analysis panel below.${loaded.skipped.length ? ` Omitted: ${loaded.skipped.join("; ")}` : ""}`,
          loaded.skipped.length ? "warning" : "success",
        );
      },
      true,
    ),
  );
  if (capturedPapers.length)
    scope.append(
      button(doc, `Use captured PDFs (${capturedPapers.length})`, async () => {
        if (isResearchWorkspaceOwnerActive({ kind: "project", projectID }))
          throw new Error(
            "Finish or cancel the active project analysis first.",
          );
        await addPapersToResearchWorkspaceProject(projectID, capturedPapers);
        const refreshed = await loadResearchWorkspaceProject(projectID);
        const papers = capturedPapers.filter((paper) =>
          refreshed.members.some(
            (member) =>
              member.sourceID === paper.sourceID &&
              !isResearchWorkspaceMemberExcluded(member),
          ),
        );
        await activate(papers, "Captured PDFs");
        // New members change the revisions and the member lists. The
        // re-render keeps the analysis area for the same project.
        await refreshResearchWorkspaceProject(root);
      }),
    );
  if (details.project.comparisonQuestions?.length) {
    scope.append(element(doc, "h4", "", "Comparison questions from chat"));
    for (const question of details.project.comparisonQuestions)
      scope.append(
        element(
          doc,
          "p",
          "pprw-muted",
          `${question.question} · conversation ${question.provenance.sessionID}, message ${question.provenance.messageID}`,
        ),
      );
  }
  content.append(scope);
  trackDirtyInputs(root);
  const surfaceState = keepOperations
    ? captureSurfaceState(root, operations)
    : undefined;
  if (keepOperations) {
    for (const child of Array.from(root.children)) {
      if (child !== operations) child.remove();
    }
    root.insertBefore(content, operations);
  } else {
    root.replaceChildren(content, operations);
  }
  if (surfaceState) restoreSurfaceState(root, operations, surfaceState);
}

const dirtyTrackedRoots = new WeakSet<HTMLElement>();

/** Marks text a reader typed, so a panel rebuild can keep it. */
function trackDirtyInputs(root: HTMLElement) {
  if (dirtyTrackedRoots.has(root)) return;
  dirtyTrackedRoots.add(root);
  // Text fields, selects (a screening decision), and checkboxes (the
  // analysis scope) all hold unsaved choices.
  const markDirty = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "INPUT" ||
      target?.tagName === "SELECT"
    )
      target.dataset.dirty = "true";
  };
  root.addEventListener("input", markDirty);
  root.addEventListener("change", markDirty);
}

function isToggle(node: HTMLElement) {
  const type = (node as HTMLInputElement).type;
  return node.tagName === "INPUT" && (type === "checkbox" || type === "radio");
}

interface KeyedControl {
  node: HTMLElement;
  key: string;
  index: number;
}

/**
 * Panel controls with a stable key: panel heading, tag, and label, plus
 * the position among equal keys (one "Record decision" per paper row).
 */
function keyedControls(root: HTMLElement, operations: HTMLElement) {
  const counts = new Map<string, number>();
  const controls: KeyedControl[] = [];
  const nodes = Array.from(
    root.querySelectorAll("button, input, textarea, select, summary"),
  ) as HTMLElement[];
  for (const node of nodes) {
    if (operations.contains(node)) continue;
    // A checkbox is named by its wrapping label; a select by its aria-label.
    const label =
      node.getAttribute("aria-label") ||
      (node as HTMLInputElement).placeholder ||
      (isToggle(node)
        ? node.closest("label")?.textContent?.trim()
        : node.textContent?.trim()) ||
      "";
    if (!label) continue;
    const heading =
      node.closest("section")?.querySelector("h3, h2")?.textContent?.trim() ??
      "";
    const key = `${heading}|${node.tagName}|${label}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    controls.push({ node, key, index });
  }
  return controls;
}

function captureSurfaceState(root: HTMLElement, operations: HTMLElement) {
  const active = root.ownerDocument.activeElement;
  const controls = keyedControls(root, operations);
  const focused = controls.find((entry) => entry.node === active);
  return {
    focused: focused && { key: focused.key, index: focused.index },
    focusWasInPanels: Boolean(
      active && root.contains(active) && !operations.contains(active),
    ),
    dirty: controls
      .filter(
        (entry) =>
          entry.node.dataset.dirty === "true" &&
          (entry.node as HTMLInputElement).type !== "file",
      )
      .map((entry) => ({
        key: entry.key,
        index: entry.index,
        toggle: isToggle(entry.node),
        value: (entry.node as HTMLInputElement).value,
        checked: Boolean((entry.node as HTMLInputElement).checked),
      })),
  };
}

function restoreSurfaceState(
  root: HTMLElement,
  operations: HTMLElement,
  state: ReturnType<typeof captureSurfaceState>,
) {
  const controls = keyedControls(root, operations);
  const find = (key: string, index: number) =>
    controls.find((entry) => entry.key === key && entry.index === index)?.node;
  // Values are restored without events, so no change handler (such as an
  // autosave) runs for a choice the reader has not confirmed.
  for (const entry of state.dirty) {
    const node = find(entry.key, entry.index) as
      | HTMLInputElement
      | HTMLSelectElement
      | undefined;
    if (!node) continue;
    if (entry.toggle) {
      if (isToggle(node) && !(node as HTMLInputElement).disabled)
        (node as HTMLInputElement).checked = entry.checked;
    } else if (node.tagName === "SELECT") {
      const select = node as HTMLSelectElement;
      if (
        (Array.from(select.options) as HTMLOptionElement[]).some(
          (option) => option.value === entry.value,
        )
      )
        select.value = entry.value;
    } else if (node.value !== entry.value) {
      node.value = entry.value;
    }
    node.dataset.dirty = "true";
  }
  if (!state.focusWasInPanels) return;
  const target = state.focused
    ? (find(state.focused.key, state.focused.index) as
        | HTMLButtonElement
        | undefined)
    : undefined;
  if (target && !target.disabled) {
    target.focus();
    return;
  }
  // The control is gone (a row was resolved), so focus the status line.
  root.querySelector<HTMLElement>("[data-project-message]")?.focus();
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

function renderArchivedProjects(
  doc: Document,
  root: HTMLElement,
  home: ResearchWorkspaceProjectHome,
  capturedPapers: readonly ResearchWorkspacePaper[],
  generation: symbol,
) {
  const archived = element(doc, "details", "pprw-project-panel");
  archived.append(
    element(
      doc,
      "summary",
      "pprw-section-title",
      `Archived projects · ${home.archivedProjects.length}`,
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
        `${project.name}${project.archivedAt ? ` · archived ${new Date(project.archivedAt).toLocaleDateString()}` : ""}`,
      ),
      button(doc, "Open", () =>
        renderProject(root, project.projectID, capturedPapers, generation),
      ),
      button(doc, "Restore", async () => {
        await restoreResearchWorkspaceProject(project.projectID);
        await renderResearchWorkspaceProjectSurface(root, { capturedPapers });
        setMessage(
          root,
          `Restored “${project.name}” to Recent projects.`,
          "success",
        );
      }),
    );
    list.append(item);
  }
  archived.append(list);
  return archived;
}

export async function renderResearchWorkspaceProjectSurface(
  root: HTMLElement,
  options: { capturedPapers?: readonly ResearchWorkspacePaper[] } = {},
) {
  if (!releaseOperations(root, "Opening all projects")) return;
  projectContexts.delete(root);
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
      root.append(
        renderArchivedProjects(doc, root, home, capturedPapers, generation),
      );
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
