/**
 * Human-readable progress and terminal state for incremental project runs.
 * A run with failed units is partial, never a plain success.
 */

export interface ResearchWorkspaceRunOutcome {
  status: "complete" | "partial";
  total: number;
  completedUnitIDs: readonly string[];
  failedUnits: ReadonlyArray<{ unitID: string; label: string }>;
  pendingUnitIDs: readonly string[];
}

export interface ResearchWorkspaceRunSummary {
  kind: "success" | "warning";
  message: string;
  /** True when running the same operation again can retry failed units. */
  resumable: boolean;
}

export function formatIncrementalProgress(params: {
  title: string;
  completed: number;
  total: number;
  label: string;
}): string {
  return `${params.title}: ${params.completed}/${params.total} · ${params.label}`;
}

export function buildRunOutcome(params: {
  checkpoint?: {
    completedUnits: readonly string[];
    failedUnits: ReadonlyArray<{ unitID: string }>;
    pendingUnits: readonly string[];
  };
  total: number;
  labelFor: (unitID: string) => string | undefined;
}): ResearchWorkspaceRunOutcome {
  const checkpoint = params.checkpoint ?? {
    completedUnits: [],
    failedUnits: [],
    pendingUnits: [],
  };
  return {
    status:
      checkpoint.failedUnits.length || checkpoint.pendingUnits.length
        ? "partial"
        : "complete",
    total: params.total,
    completedUnitIDs: [...checkpoint.completedUnits],
    failedUnits: checkpoint.failedUnits.map((unit) => ({
      unitID: unit.unitID,
      label: params.labelFor(unit.unitID) ?? unit.unitID,
    })),
    pendingUnitIDs: [...checkpoint.pendingUnits],
  };
}

function quoteList(labels: readonly string[], limit = 3) {
  const shown = labels.slice(0, limit).map((label) => `“${label}”`);
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

export function summarizeRunOutcome(
  title: string,
  outcome: ResearchWorkspaceRunOutcome,
): ResearchWorkspaceRunSummary {
  if (outcome.status === "complete") {
    return {
      kind: "success",
      message: `${title} saved to the project.`,
      resumable: false,
    };
  }
  const failed = outcome.failedUnits.length;
  const pending = outcome.pendingUnitIDs.length;
  const parts = [`${title} partial`];
  if (failed) parts.push(`${failed} of ${outcome.total} failed`);
  if (pending) parts.push(`${pending} not run`);
  const detail = failed
    ? ` Failed: ${quoteList(outcome.failedUnits.map((unit) => unit.label))}.`
    : "";
  return {
    kind: "warning",
    message: `${parts.join(" · ")}. Completed results were saved.${detail} Resume retries only the papers that did not finish.`,
    resumable: true,
  };
}
