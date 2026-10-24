import { DialogHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import {
  addPapersToResearchWorkspaceProject,
  loadResearchWorkspaceProject,
  loadResearchWorkspaceState,
} from "./facade";
import {
  captureResearchWorkspaceSelection,
  loadResearchWorkspaceSnapshotPapers,
  type ResearchWorkspaceLaunchOrigin,
  type ResearchWorkspaceSelectionSnapshot,
  type ResearchWorkspaceSkippedSelection,
} from "./selectionSnapshot";
import { createResearchWorkspaceSurfaceSelection } from "./surfaceSelection";
import {
  disposeResearchWorkspaceProjectSurface,
  getResearchWorkspaceSurfaceProject,
  refreshResearchWorkspaceProject,
  renderResearchWorkspaceProjectSurface,
} from "./projectWindowView";
import {
  hasRunningOperation,
  releaseOperations,
  setMessage,
  surfaceSelections,
} from "./projectSurfaceShared";
import { confirmCancelRunningAnalysis } from "./runGuard";
import { planResearchWorkspaceSelectionOffer } from "./selectionOffer";
import {
  researchWorkspaceSurfaceActivity,
  runResearchWorkspaceSurfaceAction,
} from "./surfaceAction";
import { element } from "./dom";
import { pluginStylesheetURL } from "../../utils/stylesheet";

declare const addon: any;
declare const Zotero: any;

const WINDOW_ROOT_ID = "paperpilot-research-workspace-window";
const WINDOW_BODY_ID = "paperpilot-research-workspace-window-body";
const SELECTION_OFFER_ID = "paperpilot-research-workspace-selection-offer";

export interface ResearchWorkspaceWindowState {
  snapshot: ResearchWorkspaceSelectionSnapshot;
  status: "opening" | "loading" | "ready" | "error";
  loadedSourceIDs: readonly string[];
  skipped: readonly ResearchWorkspaceSkippedSelection[];
  error?: string;
}

export interface OpenResearchWorkspaceOptions {
  items?: readonly any[];
  origin?: ResearchWorkspaceLaunchOrigin;
}

function actionButton(
  doc: Document,
  label: string,
  action: () => void | Promise<void>,
  variant: "primary" | "secondary" | "ghost" = "primary",
) {
  const node = element(
    doc,
    "button",
    `pprw-button pp-btn pp-btn--${variant}`,
    label,
  );
  node.type = "button";
  node.addEventListener("click", () => {
    const root = doc.getElementById(WINDOW_ROOT_ID);
    void runResearchWorkspaceSurfaceAction({
      surface: root ?? node,
      trigger: node,
      action,
      label,
      onBusy: (active) => {
        const body = doc.getElementById(WINDOW_BODY_ID);
        if (body)
          setMessage(
            body,
            active
              ? `Still working on “${active}”. Try again when it finishes.`
              : "Still working on the previous action. Try again when it finishes.",
          );
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const banner = element(doc, "div", "pprw-window-error", message);
        banner.setAttribute("role", "alert");
        const body = doc.getElementById(WINDOW_BODY_ID);
        (body ?? root)?.prepend(banner);
        Zotero.logError?.(error);
      },
    });
  });
  return node;
}

function windowBody(doc: Document) {
  return doc.getElementById(WINDOW_BODY_ID) as HTMLElement | null;
}

/**
 * Releases the analysis area of the current window body before the body is
 * replaced. Returns false when the reader keeps a running analysis.
 */
function releaseWindowBody(doc: Document, action: string) {
  const body = windowBody(doc);
  if (!body) return true;
  if (!releaseOperations(body, action)) return false;
  disposeResearchWorkspaceProjectSurface(body);
  return true;
}

function windowIsOpen() {
  const win = addon.data.dialog?.window;
  try {
    return Boolean(win && !win.closed);
  } catch {
    return false;
  }
}

function installWindowStyles(doc: Document) {
  installStylesheet(doc, "stylesheet", pluginStylesheetURL("zoteroPane.css"));
  // The window design comes after the shared pane styles and overrides them
  // only inside the window.
  installStylesheet(
    doc,
    "design",
    pluginStylesheetURL("researchWorkspaceWindow.css"),
  );
}

function installStylesheet(doc: Document, suffix: string, href: string) {
  const cssID = `${config.addonRef}-research-workspace-window-${suffix}`;
  if (doc.getElementById(cssID)) return;
  const link = element(doc, "link");
  link.id = cssID;
  link.rel = "stylesheet";
  link.href = href;
  doc.head.append(link);
}

/**
 * Draws the window header and an empty body. The selected papers are shown
 * in the body, where the reader decides what to do with them.
 */
function renderWindowFrame(root: HTMLElement) {
  const doc = root.ownerDocument;
  const header = element(doc, "header", "pprw-window-header");
  const heading = element(doc, "div", "pprw-window-heading");
  heading.append(
    element(doc, "h1", "", "Research Workspace"),
    element(
      doc,
      "p",
      "",
      "Collect papers in a project, compare them with page-linked evidence, and write up what you find.",
    ),
  );
  const useSelection = actionButton(
    doc,
    "Use Zotero selection",
    useCurrentZoteroSelection,
    "secondary",
  );
  useSelection.title =
    "Bring in the items that are selected in the Zotero library now.";
  header.append(heading, useSelection);

  const body = element(doc, "main", "pprw-window-body");
  body.id = WINDOW_BODY_ID;
  root.replaceChildren(header, body);
  return body;
}

/** Reads the snapshot's PDFs once and records them in the window state. */
function surfaceSelection(snapshot: ResearchWorkspaceSelectionSnapshot) {
  return createResearchWorkspaceSurfaceSelection(snapshot, async () => {
    const state = await loadResearchWorkspaceState();
    const loaded = await loadResearchWorkspaceSnapshotPapers(
      snapshot,
      state.preferences.maxPaperCharacters,
    );
    updateWindowState(snapshot, {
      status: "ready",
      loadedSourceIDs: Object.freeze(
        loaded.papers.map((paper) => paper.sourceID),
      ),
      skipped: loaded.skipped,
    });
    return loaded;
  });
}

function updateWindowState(
  snapshot: ResearchWorkspaceSelectionSnapshot,
  update: Omit<ResearchWorkspaceWindowState, "snapshot">,
) {
  if (addon.data.researchWorkspaceWindowState?.snapshot.id !== snapshot.id) {
    return;
  }
  addon.data.researchWorkspaceWindowState = Object.freeze({
    snapshot,
    ...update,
  });
}

async function initializeResearchWorkspaceDialog(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
  options: { preferredProjectID?: string } = {},
) {
  const doc = dialog.window.document;
  installWindowStyles(doc);
  doc.documentElement.classList.add("paperpilot-research-workspace-document");
  doc.body.classList.add("paperpilot-research-workspace-window-body");
  const root = doc.getElementById(WINDOW_ROOT_ID) as HTMLElement | null;
  if (!root) throw new Error("Research Workspace window root was not created.");

  updateWindowState(snapshot, {
    status: "loading",
    loadedSourceIDs: Object.freeze([]),
    skipped: snapshot.skipped,
  });
  const initialBody = renderWindowFrame(root);
  flushPendingSelectionOffer(dialog);
  try {
    // Saved projects are available at once. The selected PDFs are read only
    // when the reader creates or extends a project with them.
    await renderResearchWorkspaceProjectSurface(initialBody, {
      selection: surfaceSelection(snapshot),
      preferredProjectID: options.preferredProjectID,
    });
    // A newer selection may have re-initialized this window meanwhile.
    if (
      addon.data.dialog !== dialog ||
      dialog.window.closed ||
      addon.data.researchWorkspaceWindowState?.snapshot.id !== snapshot.id ||
      !initialBody.isConnected
    )
      return;
    if (addon.data.researchWorkspaceWindowState?.status === "loading")
      updateWindowState(snapshot, {
        status: "ready",
        loadedSourceIDs: Object.freeze([]),
        skipped: snapshot.skipped,
      });
  } catch (error) {
    if (
      addon.data.dialog !== dialog ||
      dialog.window.closed ||
      addon.data.researchWorkspaceWindowState?.snapshot.id !== snapshot.id ||
      !initialBody.isConnected
    ) {
      Zotero.logError?.(error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const body = renderWindowFrame(root);
    body.replaceChildren(element(doc, "div", "pprw-window-error", message));
    updateWindowState(snapshot, {
      status: "error",
      loadedSourceIDs: Object.freeze([]),
      skipped: snapshot.skipped,
      error: message,
    });
    Zotero.logError?.(error);
  }
}

/**
 * Asks before a window-manager close cancels a running analysis (spec
 * §12.3). Programmatic closes during shutdown do not fire this event.
 */
function installCloseGuard(dialog: DialogHelper) {
  const win = dialog.window;
  win.addEventListener("close", (event: Event) => {
    const body = windowBody(win.document);
    if (!body || !hasRunningOperation(body)) return;
    if (
      !confirmCancelRunningAnalysis(
        { action: "Closing the window", closing: true },
        { win },
      )
    ) {
      event.preventDefault();
    }
  });
}

/**
 * Re-initializes the open window with a newly captured selection. The
 * project the reader came from is offered first for adding the papers.
 */
async function useResearchWorkspaceSnapshot(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
  options: { preferredProjectID?: string } = {},
) {
  const doc = dialog.window.document;
  const body = windowBody(doc);
  const activity = body && researchWorkspaceSurfaceActivity(body);
  if (activity) {
    throw new Error(
      `Still working on “${activity.label ?? "the previous action"}”. Use the selection when it finishes.`,
    );
  }
  if (!releaseWindowBody(doc, "Using the new selection")) return;
  addon.data.researchWorkspaceWindowState = Object.freeze({
    snapshot,
    status: "opening",
    loadedSourceIDs: Object.freeze([]),
    skipped: snapshot.skipped,
  });
  await initializeResearchWorkspaceDialog(dialog, snapshot, options);
}

/**
 * Makes snapshot the window's current selection without re-rendering, so
 * later selection actions and offers compare against it.
 */
function adoptSelection(
  body: HTMLElement,
  snapshot: ResearchWorkspaceSelectionSnapshot,
) {
  addon.data.researchWorkspaceWindowState = Object.freeze({
    snapshot,
    status: "ready",
    loadedSourceIDs: Object.freeze([]),
    skipped: snapshot.skipped,
  });
  const selection = surfaceSelection(snapshot);
  surfaceSelections.set(body, selection);
  return selection;
}

/**
 * True when leaving the current view would lose typed text. Changed
 * checkboxes and menus are quick to redo and do not hold the view.
 */
function hasUnsavedEdits(body: HTMLElement) {
  return Boolean(
    body.querySelector(
      "textarea[data-dirty='true'], input[type='text'][data-dirty='true']",
    ),
  );
}

/**
 * Shows a new Zotero selection in the open window. The window moves to the
 * selection unless that would cancel a run or drop typed input; then a
 * banner offers it instead (spec §12.1). A selection that the open project
 * already holds keeps the project in view.
 */
async function bringSelectionIntoWindow(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
  explicit: boolean,
) {
  if (!snapshot.candidates.length && !snapshot.skipped.length) {
    if (!explicit) return;
    throw new Error(
      "Nothing is selected in the Zotero library. Select papers there, then choose Use Zotero selection again.",
    );
  }
  const doc = dialog.window.document;
  if (
    !doc.getElementById(WINDOW_ROOT_ID)?.querySelector(".pprw-window-header")
  ) {
    // The window has not drawn yet. Its load callback draws the newest
    // snapshot, so recording it here is enough.
    addon.data.researchWorkspaceWindowState = Object.freeze({
      snapshot,
      status: "opening",
      loadedSourceIDs: Object.freeze([]),
      skipped: snapshot.skipped,
    });
    return;
  }
  const body = windowBody(doc);
  const project = body ? getResearchWorkspaceSurfaceProject(body) : undefined;
  if (body && project && snapshot.candidates.length) {
    const shownSnapshot = addon.data.researchWorkspaceWindowState?.snapshot.id;
    const details = await loadResearchWorkspaceProject(project.projectID);
    // Another launch or a navigation may have replaced the view meanwhile.
    if (
      addon.data.dialog !== dialog ||
      dialog.window.closed ||
      !body.isConnected ||
      getResearchWorkspaceSurfaceProject(body)?.projectID !==
        project.projectID ||
      addon.data.researchWorkspaceWindowState?.snapshot.id !== shownSnapshot
    )
      return;
    const members = new Set(details.members.map((member) => member.sourceID));
    if (
      snapshot.candidates.every((candidate) => members.has(candidate.sourceID))
    ) {
      // Stay in the project; its selection actions now use these papers.
      adoptSelection(body, snapshot);
      if (!hasRunningOperation(body))
        await refreshResearchWorkspaceProject(body);
      setMessage(
        body,
        `“${project.projectName}” already has the ${snapshot.candidates.length === 1 ? "selected paper" : `${snapshot.candidates.length} selected papers`}.`,
      );
      return;
    }
  }
  const activity = body && researchWorkspaceSurfaceActivity(body);
  if (
    body &&
    (hasRunningOperation(body) || activity || hasUnsavedEdits(body))
  ) {
    showSelectionOffer(dialog, snapshot, {
      evenIfUnchanged: true,
      reason: hasRunningOperation(body)
        ? "An analysis is running here, so this view stays until you choose."
        : activity
          ? `“${activity.label ?? "An action"}” is still running here, so this view stays until you choose.`
          : "This view has unsaved changes, so it stays until you choose.",
    });
    return;
  }
  await useResearchWorkspaceSnapshot(dialog, snapshot, {
    preferredProjectID: project?.projectID,
  });
}

/** Adds the new selection to the project open in the window. */
async function addSnapshotToOpenProject(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
  offeredProject?: { projectID: string; projectName: string },
) {
  const body = windowBody(dialog.window.document);
  const project = body && getResearchWorkspaceSurfaceProject(body);
  if (!body || !project) {
    throw new Error("Open a project first, then add the selection to it.");
  }
  // The banner survives navigation. Add only to the project its button
  // named, never to a project opened after the offer appeared.
  if (offeredProject && offeredProject.projectID !== project.projectID) {
    throw new Error(
      `The button adds to “${offeredProject.projectName}”, but “${project.projectName}” is open now. Open “${offeredProject.projectName}” again to add the selection.`,
    );
  }
  // New members would change the scope under the running analysis.
  if (hasRunningOperation(body)) {
    throw new Error(
      "An analysis is running in this project. Add the selection after it finishes.",
    );
  }
  setMessage(body, `Loading ${snapshot.candidates.length} selected PDF(s)…`);
  // The project page now offers this selection, read once.
  const selection = adoptSelection(body, snapshot);
  const loaded = await selection.load();
  if (!loaded.papers.length) {
    throw new Error("None of the selected PDFs could be loaded.");
  }
  await addPapersToResearchWorkspaceProject(project.projectID, loaded.papers);
  await refreshResearchWorkspaceProject(body);
  const skipped = loaded.skipped.length - snapshot.skipped.length;
  setMessage(
    body,
    `Added ${loaded.papers.length} paper${loaded.papers.length === 1 ? "" : "s"} to “${project.projectName}”.${skipped > 0 ? ` ${skipped} could not be loaded.` : ""}`,
    skipped > 0 ? "warning" : "success",
  );
}

/** A selection captured before the window drew its header. */
let pendingSelectionOffer:
  | { dialog: DialogHelper; snapshot: ResearchWorkspaceSelectionSnapshot }
  | undefined;

/** Shows a selection that arrived while the window was still opening. */
function flushPendingSelectionOffer(dialog: DialogHelper) {
  const pending = pendingSelectionOffer;
  if (!pending) return;
  pendingSelectionOffer = undefined;
  if (pending.dialog === dialog) showSelectionOffer(dialog, pending.snapshot);
}

/**
 * Offers a selection captured while the window is already open. The current
 * view is never replaced silently (spec §12.1).
 */
function showSelectionOffer(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
  options: { evenIfUnchanged?: boolean; reason?: string } = {},
) {
  const doc = dialog.window.document;
  const root = doc.getElementById(WINDOW_ROOT_ID);
  const body = windowBody(doc);
  // The banner sits under the header. Until the header exists, keep the
  // newest selection and show it once the window has drawn its frame.
  if (!root?.querySelector(".pprw-window-header")) {
    pendingSelectionOffer = { dialog, snapshot };
    return;
  }
  const offeredProject = body
    ? getResearchWorkspaceSurfaceProject(body)
    : undefined;
  const offer = planResearchWorkspaceSelectionOffer({
    // An explicit request offers the selection even when it is unchanged.
    current: options.evenIfUnchanged
      ? undefined
      : addon.data.researchWorkspaceWindowState?.snapshot,
    next: snapshot,
    currentProjectName: offeredProject?.projectName,
  });
  // An empty or unchanged relaunch keeps a pending offer; only a new offer
  // replaces it.
  if (!offer) return;
  doc.getElementById(SELECTION_OFFER_ID)?.remove();
  const banner = element(doc, "section", "pprw-selection-offer");
  banner.id = SELECTION_OFFER_ID;
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "New Zotero selection");
  const titles = element(doc, "ul", "pprw-capture-list");
  for (const title of offer.titles.slice(0, 5)) {
    titles.append(element(doc, "li", "", title));
  }
  if (offer.titles.length > 5) {
    titles.append(
      element(doc, "li", "pprw-muted", `and ${offer.titles.length - 5} more`),
    );
  }
  const actions = element(doc, "div", "pprw-row");
  actions.append(
    // Re-initializing the window replaces the banner; a kept run leaves it.
    actionButton(doc, offer.useLabel, () =>
      useResearchWorkspaceSnapshot(dialog, snapshot, {
        preferredProjectID: offeredProject?.projectID,
      }),
    ),
  );
  if (offer.addLabel) {
    actions.append(
      actionButton(
        doc,
        offer.addLabel,
        async () => {
          await addSnapshotToOpenProject(
            dialog,
            snapshot,
            offeredProject
              ? {
                  projectID: offeredProject.projectID,
                  projectName: offeredProject.projectName,
                }
              : undefined,
          );
          banner.remove();
        },
        "secondary",
      ),
    );
  }
  const dismiss = actionButton(doc, "Dismiss", () => banner.remove(), "ghost");
  actions.append(dismiss);
  const message = element(
    doc,
    "p",
    "",
    options.reason ? `${offer.message} ${options.reason}` : offer.message,
  );
  message.setAttribute("role", "status");
  banner.append(message, titles, actions);
  root.querySelector(".pprw-window-header")?.after(banner);
  (actions.firstElementChild as HTMLElement | null)?.focus();
}

async function createResearchWorkspaceDialog(
  options: OpenResearchWorkspaceOptions,
) {
  const snapshot = await captureResearchWorkspaceSelection(options);
  const dialog = new DialogHelper(1, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      id: WINDOW_ROOT_ID,
      classList: ["pprw-window"],
      attributes: { "aria-label": "Paper Pilot Research Workspace" },
    })
    .setDialogData({
      loadCallback: () => {
        installCloseGuard(dialog);
        // A launch while the window opened may have replaced the snapshot.
        const latest =
          addon.data.dialog === dialog
            ? (addon.data.researchWorkspaceWindowState?.snapshot ?? snapshot)
            : snapshot;
        void initializeResearchWorkspaceDialog(dialog, latest).catch((error) =>
          Zotero.logError?.(error),
        );
      },
      beforeUnloadCallback: () => {
        const body = dialog.window.document.getElementById(WINDOW_BODY_ID);
        if (body) disposeResearchWorkspaceProjectSurface(body as HTMLElement);
      },
      unloadCallback: () => {
        if (addon.data.dialog === dialog) {
          addon.data.dialog = undefined;
          addon.data.researchWorkspaceWindowState = undefined;
        }
      },
    })
    .open("Paper Pilot · Research Workspace", {
      width: 1040,
      height: 820,
      centerscreen: true,
      resizable: true,
      fitContent: false,
      noDialogMode: true,
      alwaysRaised: false,
    });
  addon.data.dialog = dialog;
  addon.data.researchWorkspaceWindowState = Object.freeze({
    snapshot,
    status: "opening",
    loadedSourceIDs: Object.freeze([]),
    skipped: snapshot.skipped,
  });
  return dialog;
}

/** Opens the singleton modeless host or focuses the existing captured run. */
export async function openResearchWorkspace(
  options: OpenResearchWorkspaceOptions = {},
): Promise<void> {
  if (windowIsOpen()) {
    await offerToOpenWindow(options);
    return;
  }
  if (addon.data.researchWorkspaceOpening) {
    await addon.data.researchWorkspaceOpening;
    if (windowIsOpen()) await offerToOpenWindow(options);
    return;
  }
  const opening = createResearchWorkspaceDialog(options);
  addon.data.researchWorkspaceOpening = opening;
  try {
    await opening;
  } finally {
    if (addon.data.researchWorkspaceOpening === opening) {
      addon.data.researchWorkspaceOpening = undefined;
    }
  }
}

/** Focuses the open window and offers the newly captured selection. */
async function offerToOpenWindow(options: OpenResearchWorkspaceOptions) {
  const dialog = addon.data.dialog as DialogHelper;
  dialog.window.focus();
  const snapshot = await captureResearchWorkspaceSelection(options);
  if (addon.data.dialog !== dialog || dialog.window.closed) return;
  // The home already shows this exact selection; focusing is enough.
  const body = windowBody(dialog.window.document);
  const current = addon.data.researchWorkspaceWindowState?.snapshot as
    | ResearchWorkspaceSelectionSnapshot
    | undefined;
  if (
    body &&
    !getResearchWorkspaceSurfaceProject(body) &&
    current &&
    sameSources(current, snapshot)
  )
    return;
  await bringSelectionIntoWindow(dialog, snapshot, false);
}

function sameSources(
  left: ResearchWorkspaceSelectionSnapshot,
  right: ResearchWorkspaceSelectionSnapshot,
) {
  const sources = new Set(left.candidates.map((entry) => entry.sourceID));
  return (
    left.candidates.length === right.candidates.length &&
    left.skipped.length === right.skipped.length &&
    right.candidates.every((entry) => sources.has(entry.sourceID))
  );
}

/** Brings the items selected in the Zotero library into the open window. */
export async function useCurrentZoteroSelection() {
  const dialog = addon.data.dialog as DialogHelper | undefined;
  if (!dialog || !windowIsOpen()) return;
  const snapshot = await captureResearchWorkspaceSelection({
    origin: "workspace-new-selection",
  });
  if (addon.data.dialog !== dialog || dialog.window.closed) return;
  await bringSelectionIntoWindow(dialog, snapshot, true);
}

export function closeResearchWorkspaceWindow() {
  const dialog = addon.data.dialog as DialogHelper | undefined;
  addon.data.dialog = undefined;
  addon.data.researchWorkspaceWindowState = undefined;
  dialog?.window?.close();
}
