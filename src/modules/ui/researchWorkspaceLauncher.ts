import { showChatReviewPanel } from "./chatTools";

export const OPEN_RESEARCH_WORKSPACE_LABEL = "Open Research Workspace";

/**
 * Opens the Research Workspace window from the reader pane. The paper is
 * passed as the captured selection, so an already open window offers it.
 */
export async function openResearchWorkspaceFromPane(
  items: readonly unknown[] = [],
): Promise<void> {
  const { openResearchWorkspace } = await import("../researchWorkspace/window");
  await openResearchWorkspace({ items, origin: "reader-pane" });
}

export function createOpenResearchWorkspaceButton(
  doc: Document,
  params: {
    items?: readonly unknown[];
    label?: string;
    className?: string;
    onError?: (error: unknown) => void;
  } = {},
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = params.className ?? "pp-btn pp-btn--secondary";
  button.textContent = params.label ?? OPEN_RESEARCH_WORKSPACE_LABEL;
  button.title = "Open the Research Workspace window for this paper.";
  button.addEventListener("click", () => {
    clearLaunchError(button);
    void openResearchWorkspaceFromPane(params.items).catch((error) => {
      // A failed launch says why next to the button, not only in the log.
      showLaunchError(button, error);
      params.onError?.(error);
    });
  });
  return button;
}

function launchErrorNode(button: HTMLButtonElement) {
  const next = button.nextElementSibling as HTMLElement | null;
  return next?.dataset.launchError === "true" ? next : undefined;
}

function clearLaunchError(button: HTMLButtonElement) {
  launchErrorNode(button)?.remove();
}

function showLaunchError(button: HTMLButtonElement, error: unknown) {
  const node =
    launchErrorNode(button) ?? button.ownerDocument.createElement("span");
  node.dataset.launchError = "true";
  node.className = "pp-status-text pp-status-text--error";
  node.setAttribute("role", "alert");
  node.textContent = `The Research Workspace could not open: ${
    error instanceof Error ? error.message : String(error)
  }`;
  if (!node.isConnected) button.after(node);
}

/**
 * Replaces a dead-end "create a project first" error with a panel that can
 * open the Research Workspace directly.
 */
export function showResearchWorkspaceRequiredPanel(params: {
  mount: HTMLElement;
  title: string;
  body: string;
  items?: readonly unknown[];
}): HTMLElement {
  return showChatReviewPanel({
    mount: params.mount,
    title: params.title,
    body: params.body,
    confirmLabel: OPEN_RESEARCH_WORKSPACE_LABEL,
    onConfirm: async () => {
      await openResearchWorkspaceFromPane(params.items);
      return "Research Workspace opened. Create or open a project there, then try again.";
    },
  });
}

/** Adds an Open Research Workspace action under a completed review panel. */
export function appendOpenResearchWorkspaceAction(
  panel: HTMLElement,
  items?: readonly unknown[],
): void {
  if (panel.querySelector("[data-open-research-workspace]")) return;
  const button = createOpenResearchWorkspaceButton(panel.ownerDocument, {
    items,
    className: "pp-btn pp-btn--secondary",
  });
  button.dataset.openResearchWorkspace = "true";
  panel.append(button);
}
