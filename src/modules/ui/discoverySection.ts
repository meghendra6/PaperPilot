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
}

const laneViews = new WeakMap<HTMLElement, LaneViewState>();

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
  container.replaceChildren();
  if (!params.groups.length) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  const view = laneViewState(container, discoveryLaneSignature(params.groups));

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
      const rows = group.papers.map((paper) => params.buildRow(paper));
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
          showMore.remove();
        });
        section.appendChild(showMore);
      }
    }
    container.appendChild(section);
  }
}
