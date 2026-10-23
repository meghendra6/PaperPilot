import type { DiscoveryResult } from "../discovery/types";
import type {
  RecommendationGroup,
  RecommendedPaper,
} from "../relatedRecommendations";

const MAIN_LANE = "Verified main-conference papers";

/**
 * Reader-chosen lane layout. Row actions such as Add to collection re-render
 * the section, so open lanes and revealed rows are kept per container until
 * a different result set arrives.
 */
interface LaneViewState {
  signature: string;
  open: Map<string, boolean>;
  revealed: Set<string>;
  scopeOpen: boolean;
  /** Review insights the reader has open, by paper key. */
  openInsights: Set<string>;
  /** Papers whose insight was already shown, so a new one opens only once. */
  seenInsights: Set<string>;
  rendered: boolean;
}

const laneViews = new WeakMap<HTMLElement, LaneViewState>();
/** Paper key of each rendered row, to find it again after a rebuild. */
const rowKeys = new WeakMap<Element, string>();

function paperKey(paper: RecommendedPaper) {
  return paper.candidateID || paper.title;
}

interface RowFocus {
  key: string;
  action?: string;
}

/** Remembers which row button had focus, since a rebuild replaces it. */
function captureRowFocus(container: HTMLElement): RowFocus | undefined {
  const active = container.ownerDocument?.activeElement as
    | HTMLElement
    | null
    | undefined;
  if (!active || !container.contains?.(active)) return undefined;
  const row = active.closest?.(".pp-recommendation-row");
  const key = row ? rowKeys.get(row) : undefined;
  if (!row || !key) return undefined;
  return { key, action: active.dataset?.rowAction };
}

/**
 * Focuses the same control by its stable action key. Labels change between
 * renders ("Review insights" → "Cancel review insights") and buttons come and
 * go, so matching by label or position could land on a different action.
 * Without a match, focus goes to the row itself rather than to a guess.
 */
function restoreRowFocus(row: HTMLElement | undefined, focus: RowFocus) {
  if (!row) return;
  const buttons = Array.from(
    row.querySelectorAll?.("button") ?? [],
  ) as HTMLButtonElement[];
  const target = buttons.find(
    (button) =>
      focus.action !== undefined &&
      button.dataset?.rowAction === focus.action &&
      !button.disabled,
  );
  (target ?? row).focus?.({ preventScroll: true });
}

/** Identifies a result set by lane and paper identity, not by row patches. */
export function discoveryLaneSignature(
  groups: readonly RecommendationGroup[],
): string {
  return JSON.stringify(
    groups.map((group) => [
      group.category,
      group.papers.map((paper) => paper.candidateID || paper.title),
    ]),
  );
}

function laneViewState(container: HTMLElement, signature: string) {
  const previous = laneViews.get(container);
  if (previous?.signature === signature) return previous;
  const next: LaneViewState = {
    signature,
    open: new Map(),
    revealed: new Set(),
    scopeOpen: false,
    openInsights: new Set(),
    seenInsights: new Set(),
    rendered: false,
  };
  laneViews.set(container, next);
  return next;
}

export function renderDiscoverySection(params: {
  container: HTMLElement;
  groups: RecommendationGroup[];
  discovery?: DiscoveryResult;
  buildRow(paper: RecommendedPaper): HTMLElement;
}) {
  const { container } = params;
  const doc = container.ownerDocument;
  const focus = captureRowFocus(container);
  container.replaceChildren();
  if (!params.groups.length) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  const view = laneViewState(container, discoveryLaneSignature(params.groups));
  const rowsByKey = new Map<string, HTMLElement>();
  // A rebuild recreates each insight closed. Keep the reader's choice, and
  // open an insight that just arrived so its result is visible.
  const keepInsightOpenState = (row: HTMLElement, key: string) => {
    const insight = row.querySelector?.(
      "details.pp-review-insight",
    ) as HTMLDetailsElement | null;
    if (!insight) return;
    if (!view.seenInsights.has(key)) {
      view.seenInsights.add(key);
      if (view.rendered) view.openInsights.add(key);
    }
    insight.open = view.openInsights.has(key);
    insight.addEventListener("toggle", () => {
      if (insight.open) view.openInsights.add(key);
      else view.openInsights.delete(key);
    });
  };

  if (params.discovery) {
    const scope = doc.createElement("details");
    scope.className = "pp-discovery-scope";
    scope.open = view.scopeOpen;
    scope.addEventListener("toggle", () => {
      view.scopeOpen = scope.open;
    });
    const summary = doc.createElement("summary");
    summary.textContent = "Search scope and limitations";
    const plan = doc.createElement("p");
    plan.textContent = `${params.discovery.plan.primaryField}${
      params.discovery.plan.adjacentFields.length
        ? ` · adjacent: ${params.discovery.plan.adjacentFields.join(", ")}`
        : ""
    }. ${params.discovery.plan.scopeSummary}`;
    scope.append(summary, plan);
    if (params.discovery.plan.venues.length) {
      const venues = doc.createElement("ul");
      for (const venue of params.discovery.plan.venues) {
        const item = doc.createElement("li");
        item.textContent = `${venue.venueAcronym || venue.venueName}: ${venue.judgment} (${venue.confidence}) — ${venue.basis}`;
        venues.appendChild(item);
      }
      scope.appendChild(venues);
    }
    if (params.discovery.plan.queries.length) {
      const querySummary = doc.createElement("p");
      querySummary.textContent = `Query families: ${[
        ...new Set(params.discovery.plan.queries.map((query) => query.family)),
      ].join(", ")}`;
      scope.appendChild(querySummary);
    }
    if (params.discovery.limitations.length) {
      const list = doc.createElement("ul");
      for (const limitation of params.discovery.limitations) {
        const item = doc.createElement("li");
        item.textContent = limitation;
        list.appendChild(item);
      }
      scope.appendChild(list);
    }
    if (params.discovery.parseWarnings.length) {
      const warningHeading = doc.createElement("p");
      warningHeading.textContent = "Structured-output warnings:";
      const warnings = doc.createElement("ul");
      for (const warning of params.discovery.parseWarnings) {
        const item = doc.createElement("li");
        item.textContent = warning;
        warnings.appendChild(item);
      }
      scope.append(warningHeading, warnings);
    }
    container.appendChild(scope);
  }

  for (const group of params.groups) {
    const section = doc.createElement("details");
    section.open =
      view.open.get(group.category) ?? group.category === MAIN_LANE;
    section.addEventListener("toggle", () => {
      view.open.set(group.category, section.open);
    });
    section.style.borderTop = "1px solid var(--pp-border-recommendation)";
    const header = doc.createElement("summary");
    header.textContent = `${group.category} · ${group.papers.length}`;
    header.className = "pp-recommendation-group__header";
    section.appendChild(header);
    if (!group.papers.length) {
      const empty = doc.createElement("div");
      empty.className = "pp-related-empty";
      empty.textContent =
        group.category === MAIN_LANE
          ? "No papers met the verified main-conference evidence criteria. Other lanes were not promoted to fill this list."
          : "No papers were returned for this lane.";
      section.appendChild(empty);
    } else {
      const visible = view.revealed.has(group.category)
        ? group.papers.length
        : group.category === MAIN_LANE
          ? 8
          : 6;
      const rows = group.papers.map((paper) => {
        const row = params.buildRow(paper);
        const key = paperKey(paper);
        rowKeys.set(row, key);
        rowsByKey.set(key, row);
        keepInsightOpenState(row, key);
        return row;
      });
      for (const [index, row] of rows.entries()) {
        if (index >= visible) row.style.display = "none";
        section.appendChild(row);
      }
      if (group.papers.length > visible) {
        const showMore = doc.createElement("button");
        showMore.className = "pp-btn pp-btn--ghost";
        showMore.textContent = `Show ${group.papers.length - visible} more`;
        showMore.addEventListener("click", () => {
          view.revealed.add(group.category);
          for (const row of rows) row.style.display = "";
          // Focus the first newly shown row before its button disappears.
          const firstRevealed = rows[visible] as HTMLElement | undefined;
          if (firstRevealed) {
            // tabIndex -1 makes the row focusable without adding a tab stop.
            firstRevealed.tabIndex = -1;
            firstRevealed.focus?.({ preventScroll: false });
          }
          showMore.remove();
        });
        section.appendChild(showMore);
      }
    }
    container.appendChild(section);
  }
  view.rendered = true;
  if (focus) restoreRowFocus(rowsByKey.get(focus.key), focus);
}
