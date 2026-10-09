import type { ResearchWorkspaceArtifact } from "./persistence/contracts";

/**
 * How the project window repairs a stale or partial artifact (spec §13.7).
 * Rerun reuses the visible controls, so it keeps their consent, scope, and
 * cancellation behavior instead of starting a hidden run.
 */
export type ResearchWorkspaceArtifactRerunPlan =
  | {
      kind: "operation";
      /** Label of the analysis-panel button that produces this artifact. */
      buttonLabel: string;
      sourceIDs: readonly string[];
      minSources: number;
      note?: string;
    }
  | {
      kind: "panel";
      /** Class of the project panel that rebuilds this derived artifact. */
      panelClass: string;
      buttonLabel: string;
    }
  | { kind: "reader"; message: string };

const OPERATION_BUTTONS: Record<
  string,
  { buttonLabel: string; minSources: number; note?: string }
> = {
  claims: { buttonLabel: "Extract claims", minSources: 1 },
  "methodology-audit": { buttonLabel: "Methodology Audit", minSources: 1 },
  reproducibility: { buttonLabel: "Reproducibility", minSources: 1 },
  "paper-to-code": { buttonLabel: "Paper-to-Code", minSources: 1 },
  "evidence-matrix": { buttonLabel: "Evidence Matrix", minSources: 2 },
  "quick-compare": { buttonLabel: "Quick Compare", minSources: 2 },
  "literature-graph": { buttonLabel: "Relationship Graph", minSources: 2 },
  "project-synthesis": { buttonLabel: "Project synthesis", minSources: 2 },
  "cross-paper-mastery": {
    buttonLabel: "Cross-paper question",
    minSources: 2,
  },
  "citation-context-extraction": {
    buttonLabel: "Extract citation contexts locally",
    minSources: 1,
  },
  "citation-stance": {
    buttonLabel: "Extract citation contexts locally",
    minSources: 1,
    note: "Review the new snippets and approve them again before stance analysis.",
  },
};

const PANEL_REBUILDS: Record<
  string,
  { panelClass: string; buttonLabel: string }
> = {
  "contradiction-gap-dashboard": {
    panelClass: "pprw-contradiction-gap-panel",
    buttonLabel: "Build / refresh local dashboard",
  },
  "citation-reference-health": {
    panelClass: "pprw-citation-health-panel",
    buttonLabel: "Build / refresh citation health checklist",
  },
};

export function canRerunResearchWorkspaceArtifact(
  artifact: Pick<ResearchWorkspaceArtifact, "status">,
): boolean {
  return artifact.status === "stale" || artifact.status === "partial";
}

export function planResearchWorkspaceArtifactRerun(
  artifact: Pick<ResearchWorkspaceArtifact, "lineage" | "sourceIDs">,
): ResearchWorkspaceArtifactRerunPlan {
  const operation = artifact.lineage.operation;
  const direct = OPERATION_BUTTONS[operation];
  if (direct) {
    return {
      kind: "operation",
      buttonLabel: direct.buttonLabel,
      sourceIDs: [...artifact.sourceIDs],
      minSources: direct.minSources,
      ...(direct.note ? { note: direct.note } : {}),
    };
  }
  const panel = PANEL_REBUILDS[operation];
  if (panel) return { kind: "panel", ...panel };
  return {
    kind: "reader",
    message:
      operation === "reader-paper-mastery"
        ? "Paper Mastery runs in the Reader. Open the paper and use Paper Mastery in the Paper Pilot pane."
        : operation === "reader-critical-read"
          ? "Critical Read runs in the Reader. Open the paper and use Revise from here in the Paper Pilot pane."
          : "This artifact cannot be rerun from the project window.",
  };
}
