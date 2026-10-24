import { button as createButton, metric as createMetric, element } from "./dom";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import { confirmCancelRunningAnalysis } from "./runGuard";
import { runResearchWorkspaceSurfaceAction } from "./surfaceAction";
import type { ResearchWorkspaceSurfaceSelection } from "./surfaceSelection";
import {
  disposeResearchWorkspaceView,
  isResearchWorkspaceViewRunning,
} from "./view";
export const generations = new WeakMap<HTMLElement, symbol>();

export const activeOperationRoots = new WeakMap<HTMLElement, HTMLElement>();

/** The Zotero selection the window offers on each surface root. */
export const surfaceSelections = new WeakMap<
  HTMLElement,
  ResearchWorkspaceSurfaceSelection
>();

/** The selected papers that have a PDF, or undefined without a selection. */
export function selectionWithPapers(
  root: HTMLElement,
): ResearchWorkspaceSurfaceSelection | undefined {
  const selection = surfaceSelections.get(root);
  return selection?.titles.length ? selection : undefined;
}

/**
 * Reads the selected PDFs and reports progress through `report`. Throws
 * when none of them could be read. `unread` counts the PDFs that failed to
 * load, not the items the launcher skipped.
 */
export async function loadSelectionPapers(
  selection: ResearchWorkspaceSurfaceSelection,
  report: (message: string) => void,
): Promise<{ papers: readonly ResearchWorkspacePaper[]; unread: number }> {
  if (!selection.loaded())
    report(
      `Reading ${selection.titles.length} PDF${selection.titles.length === 1 ? "" : "s"} on this computer…`,
    );
  const loaded = await selection.load({ onStatus: report });
  if (!loaded.papers.length) {
    const failure = loaded.skipped.find(
      (entry) => entry.code === "load-failed",
    );
    throw new Error(
      "None of the selected PDFs could be read. " +
        (failure?.reason ? `${failure.reason.slice(0, 500)} ` : "") +
        "Check the PDF in Zotero, then try again. If Zotero's PDF reader is not responding, restart Zotero before retrying.",
    );
  }
  return {
    papers: loaded.papers,
    unread: Math.max(0, loaded.skipped.length - selection.skipped.length),
  };
}

/** For example "Created “Review” with 3 papers. 1 PDF could not be read." */
export function addedPapersMessage(
  lead: string,
  added: number,
  unread: number,
): string {
  return `${lead} ${added} paper${added === 1 ? "" : "s"}.${
    unread
      ? ` ${unread} PDF${unread === 1 ? "" : "s"} could not be read and ${unread === 1 ? "was" : "were"} left out.`
      : ""
  }`;
}

export function disposeOperations(root: HTMLElement) {
  const operations = activeOperationRoots.get(root);
  if (operations) disposeResearchWorkspaceView(operations);
  activeOperationRoots.delete(root);
}

/** True while the project surface hosts an analysis that is still running. */
export function hasRunningOperation(root: HTMLElement): boolean {
  const operations = activeOperationRoots.get(root);
  return Boolean(operations && isResearchWorkspaceViewRunning(operations));
}

/**
 * Disposes the analysis area before an action that replaces it. A running
 * analysis is cancelled only after an explicit choice (spec §12.3). Returns
 * false when the reader keeps the run; the caller must then stop.
 */
export function releaseOperations(root: HTMLElement, action: string): boolean {
  if (
    hasRunningOperation(root) &&
    !confirmCancelRunningAnalysis(
      { action },
      { win: root.ownerDocument.defaultView },
    )
  ) {
    setMessage(
      root,
      "The analysis is still running. Wait for it to finish, or use Cancel in the analysis panel first.",
    );
    return false;
  }
  disposeOperations(root);
  return true;
}

export function button(
  doc: Document,
  label: string,
  action: () => void | Promise<void>,
  primary = false,
) {
  return createButton(
    doc,
    label,
    (node) => {
      const root = node.closest<HTMLElement>(
        "[data-research-workspace-project-surface]",
      );
      if (!root) return;
      return runResearchWorkspaceSurfaceAction({
        surface: root,
        trigger: node,
        action,
        onError: (error) => reportProjectError(root, error),
        label: node.getAttribute("aria-label") || node.textContent || undefined,
        // A click that has to wait is announced, so the button does not
        // look broken while an earlier action reads PDFs or opens a window.
        onBusy: (active) =>
          setMessage(
            root,
            active
              ? `Still working on “${active}”. Try again when it finishes.`
              : "Still working on the previous action. Try again when it finishes.",
          ),
      });
    },
    `pprw-button pp-btn ${primary ? "pp-btn--primary" : "pp-btn--secondary"}`,
  );
}

/** A visible label around a form control. */
export function labeledField(
  doc: Document,
  label: string,
  control: HTMLElement,
  hint?: string,
) {
  const field = element(doc, "label", "pprw-field");
  field.append(element(doc, "span", "pprw-field-label", label), control);
  if (hint) field.append(element(doc, "span", "pprw-field-hint", hint));
  return field;
}

/** A status line next to a form, so its errors stay beside the control. */
export function formStatus(doc: Document) {
  const node = element(doc, "p", "pprw-form-status");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  const show = (text: string, kind: string) => {
    node.setAttribute("role", kind === "error" ? "alert" : "status");
    node.textContent = text;
    node.dataset.kind = kind;
  };
  return {
    node,
    info: (text: string) => show(text, "info"),
    error(error: unknown) {
      show(error instanceof Error ? error.message : String(error), "error");
      logProjectError(error);
    },
    clear() {
      node.textContent = "";
      delete node.dataset.kind;
    },
  };
}

export function textInput(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "input", "pprw-input");
  node.type = "text";
  node.placeholder = placeholder;
  node.setAttribute("aria-label", placeholder);
  node.value = value;
  return node;
}

export function textArea(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "textarea", "pprw-input pprw-textarea");
  node.placeholder = placeholder;
  node.setAttribute("aria-label", placeholder);
  node.value = value;
  node.rows = 7;
  return node;
}

export function setMessage(root: HTMLElement, message: string, kind = "info") {
  let node = root.querySelector<HTMLElement>("[data-project-message]");
  if (!node) {
    node = element(root.ownerDocument, "div", "pprw-status");
    node.dataset.projectMessage = "true";
    root.prepend(node);
  }
  // An error is announced assertively even when the line was created for a
  // polite status first.
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  node.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  node.textContent = message;
  node.dataset.kind = kind;
  if (kind === "error") logProjectError(new Error(message));
}

export function logProjectError(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  try {
    Zotero.logError?.(normalized);
  } catch {
    console.error(normalized);
  }
}

export function reportProjectError(root: HTMLElement, error: unknown) {
  setMessage(
    root,
    error instanceof Error ? error.message : String(error),
    "error",
  );
}

export function isCurrent(root: HTMLElement, generation: symbol) {
  return generations.get(root) === generation;
}

export function metric(doc: Document, value: number, label: string) {
  return createMetric(doc, {
    className: "pprw-home-metric",
    label,
    value: value.toLocaleString(),
  });
}

export function markTemplateRecommendation(
  doc: Document,
  section: HTMLElement,
  details: ResearchWorkspaceProjectDetails,
  capabilityID: string,
) {
  if (!details.project.capabilityPresetIDs?.includes(capabilityID)) return;
  section.classList.add("pprw-template-recommended");
  section.dataset.recommendedCapability = capabilityID;
  const heading = section.querySelector("h3");
  heading?.append(
    element(doc, "span", "pprw-template-recommended-badge", "Recommended"),
  );
}
export interface ProjectOpenOptions {
  /** Papers that are already read; the analysis tools open with them. */
  analyze?: {
    papers: readonly ResearchWorkspacePaper[];
    scopeLabel: string;
  };
  /** A status line shown once the project is drawn. */
  message?: { text: string; kind: "info" | "success" | "warning" };
}

export interface ProjectNavigation {
  renderProject(
    root: HTMLElement,
    projectID: string,
    papers: readonly ResearchWorkspacePaper[],
    generation: symbol,
    options?: ProjectOpenOptions,
  ): Promise<void>;
  renderHome(
    root: HTMLElement,
    options?: { capturedPapers?: readonly ResearchWorkspacePaper[] },
  ): Promise<void>;
}
