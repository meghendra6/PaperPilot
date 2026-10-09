import type { ResearchWorkspaceSelectionSnapshot } from "./selectionSnapshot";

/**
 * What the open Research Workspace window offers when a launcher captures a
 * new selection (spec §12.1). The window never replaces its view silently.
 */
export interface ResearchWorkspaceSelectionOffer {
  count: number;
  titles: readonly string[];
  useLabel: string;
  /** Present only while a project is open in the window. */
  addLabel?: string;
  message: string;
}

function sourceSet(
  snapshot: Pick<ResearchWorkspaceSelectionSnapshot, "candidates">,
) {
  return new Set(snapshot.candidates.map((candidate) => candidate.sourceID));
}

export function planResearchWorkspaceSelectionOffer(params: {
  current?: Pick<ResearchWorkspaceSelectionSnapshot, "candidates">;
  next: Pick<ResearchWorkspaceSelectionSnapshot, "candidates" | "skipped">;
  currentProjectName?: string;
}): ResearchWorkspaceSelectionOffer | undefined {
  const count = params.next.candidates.length;
  if (!count) return undefined;
  if (params.current) {
    const current = sourceSet(params.current);
    const next = sourceSet(params.next);
    if (
      current.size === next.size &&
      [...next].every((sourceID) => current.has(sourceID))
    ) {
      return undefined;
    }
  }
  const noun = count === 1 ? "paper" : "papers";
  const skipped = params.next.skipped.length;
  return {
    count,
    titles: params.next.candidates.map((candidate) => candidate.title),
    useLabel: count === 1 ? "Use this paper" : `Use these ${count} papers`,
    ...(params.currentProjectName
      ? { addLabel: `Add to “${params.currentProjectName}”` }
      : {}),
    message: `New Zotero selection: ${count} ${noun} with a readable PDF${skipped ? ` (${skipped} skipped)` : ""}. The current view stays until you choose.`,
  };
}
