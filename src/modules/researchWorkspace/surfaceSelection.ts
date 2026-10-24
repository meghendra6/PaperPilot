import type {
  ResearchWorkspaceSelectionSnapshot,
  ResearchWorkspaceSkipCode,
  ResearchWorkspaceSkippedSelection,
  ResearchWorkspaceSnapshotLoadResult,
} from "./selectionSnapshot";

/**
 * The Zotero selection a window was opened with. The surface shows its
 * titles at once and reads the PDFs only when an action needs them.
 */
export interface ResearchWorkspaceSurfaceSelection {
  readonly id: string;
  readonly selectedCount: number;
  readonly titles: readonly string[];
  readonly sourceIDs: readonly string[];
  readonly skipped: readonly ResearchWorkspaceSkippedSelection[];
  /** Reads the selected PDFs once. Later calls share the result. */
  load(): Promise<ResearchWorkspaceSnapshotLoadResult>;
  /** The result of a finished load, if any. */
  loaded(): ResearchWorkspaceSnapshotLoadResult | undefined;
}

export function createResearchWorkspaceSurfaceSelection(
  snapshot: Pick<
    ResearchWorkspaceSelectionSnapshot,
    "id" | "selectedCount" | "candidates" | "skipped"
  >,
  read: () => Promise<ResearchWorkspaceSnapshotLoadResult>,
): ResearchWorkspaceSurfaceSelection {
  let pending: Promise<ResearchWorkspaceSnapshotLoadResult> | undefined;
  let result: ResearchWorkspaceSnapshotLoadResult | undefined;
  return Object.freeze({
    id: snapshot.id,
    selectedCount: snapshot.selectedCount,
    titles: Object.freeze(snapshot.candidates.map((entry) => entry.title)),
    sourceIDs: Object.freeze(
      snapshot.candidates.map((entry) => entry.sourceID),
    ),
    skipped: snapshot.skipped,
    load() {
      // A failed read is not cached, so the next action tries again. That
      // includes a read where no selected PDF could be extracted.
      pending ??= read().then(
        (value) => {
          if (!value.papers.length && snapshot.candidates.length) {
            pending = undefined;
            return value;
          }
          result = value;
          return value;
        },
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
      return pending;
    },
    loaded: () => result,
  });
}

const SKIP_LABELS: Record<ResearchWorkspaceSkipCode, string> = {
  "no-pdf": "no PDF attached",
  "ambiguous-pdf": "more than one PDF; select the PDF itself",
  "not-pdf": "not a PDF",
  "duplicate-source": "already in the selection",
  "selection-limit": "over the 12-paper limit",
  unavailable: "not available",
  "load-failed": "the PDF could not be read",
  "source-changed": "the PDF changed while it was read",
};

export function describeResearchWorkspaceSkip(
  code: ResearchWorkspaceSkipCode,
): string {
  return SKIP_LABELS[code] ?? "not available";
}

export interface ResearchWorkspaceSelectionSummary {
  /** For example "3 papers selected in Zotero". */
  headline: string;
  /** For example "1 item was skipped." Empty when nothing was skipped. */
  skippedLine: string;
  visibleTitles: readonly string[];
  hiddenCount: number;
}

export const SELECTION_SUMMARY_TITLE_LIMIT = 5;

export function summarizeResearchWorkspaceSelection(
  selection: Pick<ResearchWorkspaceSurfaceSelection, "titles" | "skipped">,
): ResearchWorkspaceSelectionSummary {
  const count = selection.titles.length;
  const skipped = selection.skipped.length;
  return {
    headline: count
      ? `${count} paper${count === 1 ? "" : "s"} with a PDF selected in Zotero`
      : "No selected item has a readable PDF",
    skippedLine: skipped
      ? `${skipped} selected item${skipped === 1 ? " was" : "s were"} skipped.`
      : "",
    visibleTitles: selection.titles.slice(0, SELECTION_SUMMARY_TITLE_LIMIT),
    hiddenCount: Math.max(0, count - SELECTION_SUMMARY_TITLE_LIMIT),
  };
}

/** A name the reader can keep or replace before creating the project. */
export function defaultResearchWorkspaceProjectName(
  titles: readonly string[],
  date: Date,
): string {
  if (titles.length === 1) {
    const title = titles[0].trim();
    if (title) return title.length > 80 ? `${title.slice(0, 79)}…` : title;
  }
  return `Research set (${formatResearchWorkspaceDay(date)})`;
}

/**
 * A day such as "Oct 24, 2026". The interface is in English, so dates follow
 * it instead of the system locale.
 */
export function formatResearchWorkspaceDay(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function papersLabel(count: number): string {
  return `${count} paper${count === 1 ? "" : "s"}`;
}
