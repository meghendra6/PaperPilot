import { button as createButton, metric as createMetric, element } from "./dom";
import type { ResearchWorkspacePaper } from "./paperSource";
import type { ResearchWorkspaceProjectDetails } from "./projectController";
import { runResearchWorkspaceSurfaceAction } from "./surfaceAction";
import { disposeResearchWorkspaceView } from "./view";
export const generations = new WeakMap<HTMLElement, symbol>();

export const activeOperationRoots = new WeakMap<HTMLElement, HTMLElement>();

export function disposeOperations(root: HTMLElement) {
  const operations = activeOperationRoots.get(root);
  if (operations) disposeResearchWorkspaceView(operations);
  activeOperationRoots.delete(root);
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
      });
    },
    `pprw-button pp-btn ${primary ? "pp-btn--primary" : "pp-btn--secondary"}`,
  );
}

export function textInput(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "input", "pprw-input");
  node.type = "text";
  node.placeholder = placeholder;
  node.value = value;
  return node;
}

export function textArea(doc: Document, placeholder: string, value = "") {
  const node = element(doc, "textarea", "pprw-input pprw-textarea");
  node.placeholder = placeholder;
  node.value = value;
  node.rows = 7;
  return node;
}

export function setMessage(root: HTMLElement, message: string, kind = "info") {
  let node = root.querySelector<HTMLElement>("[data-project-message]");
  if (!node) {
    node = element(root.ownerDocument, "div", "pprw-status");
    node.dataset.projectMessage = "true";
    node.setAttribute("role", kind === "error" ? "alert" : "status");
    node.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    root.prepend(node);
  }
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

export function capabilityPresetIDs(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
export interface ProjectNavigation {
  renderProject(
    root: HTMLElement,
    projectID: string,
    papers: readonly ResearchWorkspacePaper[],
    generation: symbol,
  ): Promise<void>;
  renderHome(
    root: HTMLElement,
    options?: { capturedPapers?: readonly ResearchWorkspacePaper[] },
  ): Promise<void>;
}
