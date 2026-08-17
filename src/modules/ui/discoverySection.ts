import type { DiscoveryResult } from "../discovery/types";
import type {
  RecommendationGroup,
  RecommendedPaper,
} from "../relatedRecommendations";

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

  if (params.discovery) {
    const scope = doc.createElement("details");
    scope.className = "pp-discovery-scope";
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
    section.open = group.category === "Verified main-conference papers";
    section.style.borderTop = "1px solid var(--pp-border-recommendation)";
    const header = doc.createElement("summary");
    header.textContent = `${group.category} · ${group.papers.length}`;
    header.className = "pp-recommendation-group__header";
    section.appendChild(header);
    if (!group.papers.length) {
      const empty = doc.createElement("div");
      empty.className = "pp-related-empty";
      empty.textContent =
        group.category === "Verified main-conference papers"
          ? "No papers met the verified main-conference evidence criteria. Other lanes were not promoted to fill this list."
          : "No papers were returned for this lane.";
      section.appendChild(empty);
    } else {
      const visible =
        group.category === "Verified main-conference papers" ? 8 : 6;
      for (const [index, paper] of group.papers.entries()) {
        const row = params.buildRow(paper);
        if (index >= visible) row.style.display = "none";
        section.appendChild(row);
      }
      if (group.papers.length > visible) {
        const showMore = doc.createElement("button");
        showMore.className = "pp-btn pp-btn--ghost";
        showMore.textContent = `Show ${group.papers.length - visible} more`;
        showMore.addEventListener("click", () => {
          for (const row of Array.from(
            section.querySelectorAll(".pp-recommendation-row"),
          )) {
            (row as HTMLElement).style.display = "";
          }
          showMore.remove();
        });
        section.appendChild(showMore);
      }
    }
    container.appendChild(section);
  }
}
