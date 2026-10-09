import { DialogHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import {
  addPapersToResearchWorkspaceProject,
  loadResearchWorkspaceState,
} from "./facade";
import {
  captureResearchWorkspaceSelection,
  loadResearchWorkspaceSnapshotPapers,
  type ResearchWorkspaceLaunchOrigin,
  type ResearchWorkspaceSelectionSnapshot,
  type ResearchWorkspaceSkippedSelection,
} from "./selectionSnapshot";
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
} from "./projectSurfaceShared";
import { confirmCancelRunningAnalysis } from "./runGuard";
import { planResearchWorkspaceSelectionOffer } from "./selectionOffer";
import {
  replaceResearchWorkspaceDialogAfterCreate,
  runResearchWorkspaceSurfaceAction,
} from "./surfaceAction";
import { element } from "./dom";

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
  const cssID = `${config.addonRef}-research-workspace-window-stylesheet`;
  if (doc.getElementById(cssID)) return;
  const link = element(doc, "link");
  link.id = cssID;
  link.rel = "stylesheet";
  link.href = `chrome://${config.addonRef}/content/zoteroPane.css`;
  doc.head.append(link);
}

function renderSkipped(
  doc: Document,
  skipped: readonly ResearchWorkspaceSkippedSelection[],
) {
  if (!skipped.length) return undefined;
  const details = element(doc, "details", "pprw-capture-skipped");
  const summary = element(
    doc,
    "summary",
    "pprw-capture-skipped-title",
    `${skipped.length} selected row${skipped.length === 1 ? " was" : "s were"} skipped`,
  );
  const list = element(doc, "ul", "pprw-capture-list");
  for (const entry of skipped) {
    const item = element(doc, "li", "pprw-capture-list-item");
    item.append(
      element(doc, "strong", "", entry.title),
      element(doc, "span", "", `${entry.code}: ${entry.reason}`),
    );
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function renderWindowFrame(
  root: HTMLElement,
  snapshot: ResearchWorkspaceSelectionSnapshot,
  skipped: readonly ResearchWorkspaceSkippedSelection[],
) {
  const doc = root.ownerDocument;
  const header = element(doc, "header", "pprw-window-header");
  const heading = element(doc, "div", "pprw-window-heading");
  heading.append(
    element(doc, "h1", "", "Research Workspace"),
    element(
      doc,
      "p",
      "",
      `${snapshot.selectedCount} selected · ${snapshot.candidates.length} exact PDF${snapshot.candidates.length === 1 ? "" : "s"} captured at ${new Date(snapshot.capturedAt).toLocaleString()}.`,
    ),
  );
  header.append(
    heading,
    actionButton(
      doc,
      "Start a new selection",
      replaceResearchWorkspaceSelection,
    ),
  );

  const sources = element(doc, "div", "pprw-capture-sources");
  if (snapshot.candidates.length) {
    for (const candidate of snapshot.candidates) {
      const source = element(doc, "div", "pprw-capture-source");
      source.append(
        element(doc, "strong", "", candidate.title),
        element(
          doc,
          "span",
          "",
          `Library ${candidate.libraryID} · PDF ${candidate.attachmentKey}`,
        ),
      );
      sources.append(source);
    }
  } else {
    sources.append(
      element(
        doc,
        "p",
        "pprw-muted",
        "No readable PDF was captured. The workspace home remains available.",
      ),
    );
  }

  const skippedPanel = renderSkipped(doc, skipped);
  const body = element(doc, "main", "pprw-window-body");
  body.id = WINDOW_BODY_ID;
  root.replaceChildren(header, sources);
  if (skippedPanel) root.append(skippedPanel);
  root.append(body);
  return body;
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
  const initialBody = renderWindowFrame(root, snapshot, snapshot.skipped);
  flushPendingSelectionOffer(dialog);
  try {
    // Saved projects and results are available before any PDF extraction.
    await renderResearchWorkspaceProjectSurface(initialBody);
    if (addon.data.dialog !== dialog || dialog.window.closed) return;
    updateWindowState(snapshot, {
      status: "ready",
      loadedSourceIDs: Object.freeze([]),
      skipped: snapshot.skipped,
    });
    if (snapshot.candidates.length) {
      const prepare = actionButton(
        doc,
        `Prepare captured PDFs (${snapshot.candidates.length})`,
        async () => {
          // Ask before loading so a kept run does not waste the extraction.
          if (!releaseWindowBody(doc, "Preparing the captured PDFs")) return;
          prepare.disabled = true;
          prepare.textContent = "Loading captured PDFs…";
          try {
            const state = await loadResearchWorkspaceState();
            const loaded = await loadResearchWorkspaceSnapshotPapers(
              snapshot,
              state.preferences.maxPaperCharacters,
            );
            if (addon.data.dialog !== dialog || dialog.window.closed) return;
            // A run started while the PDFs loaded still needs a choice.
            if (!releaseWindowBody(doc, "Preparing the captured PDFs")) return;
            const body = renderWindowFrame(root, snapshot, loaded.skipped);
            updateWindowState(snapshot, {
              status: "ready",
              loadedSourceIDs: Object.freeze(
                loaded.papers.map((paper) => paper.sourceID),
              ),
              skipped: loaded.skipped,
            });
            await renderResearchWorkspaceProjectSurface(body, {
              capturedPapers: loaded.papers,
            });
          } finally {
            prepare.disabled = false;
            prepare.textContent = `Prepare captured PDFs (${snapshot.candidates.length})`;
          }
        },
      );
      root.querySelector(".pprw-window-header")?.append(prepare);
    }
  } catch (error) {
    if (addon.data.dialog !== dialog || dialog.window.closed) return;
    const message = error instanceof Error ? error.message : String(error);
    const body = renderWindowFrame(root, snapshot, snapshot.skipped);
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

/** Re-initializes the open window with a newly captured selection. */
async function useResearchWorkspaceSnapshot(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
) {
  const doc = dialog.window.document;
  if (!releaseWindowBody(doc, "Using the new selection")) return;
  addon.data.researchWorkspaceWindowState = Object.freeze({
    snapshot,
    status: "opening",
    loadedSourceIDs: Object.freeze([]),
    skipped: snapshot.skipped,
  });
  await initializeResearchWorkspaceDialog(dialog, snapshot);
}

/** Adds the new selection to the project open in the window. */
async function addSnapshotToOpenProject(
  dialog: DialogHelper,
  snapshot: ResearchWorkspaceSelectionSnapshot,
) {
  const body = windowBody(dialog.window.document);
  const project = body && getResearchWorkspaceSurfaceProject(body);
  if (!body || !project) {
    throw new Error("Open a project first, then add the selection to it.");
  }
  // New members would change the scope under the running analysis.
  if (hasRunningOperation(body)) {
    throw new Error(
      "An analysis is running in this project. Add the selection after it finishes.",
    );
  }
  setMessage(body, `Loading ${snapshot.candidates.length} selected PDF(s)…`);
  const state = await loadResearchWorkspaceState();
  const loaded = await loadResearchWorkspaceSnapshotPapers(
    snapshot,
    state.preferences.maxPaperCharacters,
  );
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
  const offer = planResearchWorkspaceSelectionOffer({
    current: addon.data.researchWorkspaceWindowState?.snapshot,
    next: snapshot,
    currentProjectName: body
      ? getResearchWorkspaceSurfaceProject(body)?.projectName
      : undefined,
  });
  doc.getElementById(SELECTION_OFFER_ID)?.remove();
  if (!offer) return;
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
      useResearchWorkspaceSnapshot(dialog, snapshot),
    ),
  );
  if (offer.addLabel) {
    actions.append(
      actionButton(
        doc,
        offer.addLabel,
        async () => {
          await addSnapshotToOpenProject(dialog, snapshot);
          banner.remove();
        },
        "secondary",
      ),
    );
  }
  const dismiss = actionButton(doc, "Dismiss", () => banner.remove(), "ghost");
  actions.append(dismiss);
  const message = element(doc, "p", "", offer.message);
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
        void initializeResearchWorkspaceDialog(dialog, snapshot).catch(
          (error) => Zotero.logError?.(error),
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
  showSelectionOffer(dialog, snapshot);
}

export async function replaceResearchWorkspaceSelection() {
  const current = addon.data.dialog as DialogHelper | undefined;
  const doc = current?.window?.document;
  if (doc && !releaseWindowBody(doc, "Starting a new selection")) return;
  await replaceResearchWorkspaceDialogAfterCreate(current, () =>
    createResearchWorkspaceDialog({ origin: "workspace-new-selection" }),
  );
}

export function closeResearchWorkspaceWindow() {
  const dialog = addon.data.dialog as DialogHelper | undefined;
  addon.data.dialog = undefined;
  addon.data.researchWorkspaceWindowState = undefined;
  dialog?.window?.close();
}
