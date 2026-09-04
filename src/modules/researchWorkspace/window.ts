import { DialogHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import { loadResearchWorkspaceState } from "./facade";
import {
  captureResearchWorkspaceSelection,
  loadResearchWorkspaceSnapshotPapers,
  type ResearchWorkspaceLaunchOrigin,
  type ResearchWorkspaceSelectionSnapshot,
  type ResearchWorkspaceSkippedSelection,
} from "./selectionSnapshot";
import {
  disposeResearchWorkspaceProjectSurface,
  renderResearchWorkspaceProjectSurface,
} from "./projectWindowView";
import {
  replaceResearchWorkspaceDialogAfterCreate,
  runResearchWorkspaceSurfaceAction,
} from "./surfaceAction";
import { element } from "./dom";

declare const addon: any;
declare const Zotero: any;

const WINDOW_ROOT_ID = "paperpilot-research-workspace-window";
const WINDOW_BODY_ID = "paperpilot-research-workspace-window-body";

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
) {
  const node = element(
    doc,
    "button",
    "pprw-button pp-btn pp-btn--primary",
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
  initialBody.replaceChildren(
    element(doc, "div", "pprw-window-loading", "Loading captured PDFs…"),
  );

  try {
    const state = await loadResearchWorkspaceState();
    const loaded = await loadResearchWorkspaceSnapshotPapers(
      snapshot,
      state.preferences.maxPaperCharacters,
    );
    if (addon.data.dialog !== dialog || dialog.window.closed) return;
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
    addon.data.dialog.window.focus();
    return;
  }
  if (addon.data.researchWorkspaceOpening) {
    await addon.data.researchWorkspaceOpening;
    if (windowIsOpen()) addon.data.dialog.window.focus();
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

export async function replaceResearchWorkspaceSelection() {
  const current = addon.data.dialog as DialogHelper | undefined;
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
