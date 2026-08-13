import {
  buildRecommendationMetadataLine,
  type RecommendedPaper,
} from "../relatedRecommendations";

export interface DiscoveryRowActions {
  onOpen(paper: RecommendedPaper): void | Promise<void>;
  onAdd(paper: RecommendedPaper): void | Promise<void>;
  onOpenURL(url: string): void;
  onReviewInsight(paper: RecommendedPaper): void | Promise<void>;
  onError(error: unknown): void;
}

function publicationBadge(paper: RecommendedPaper) {
  if (paper.publicationClass === "verified_main") {
    return "Main paper · officially verified";
  }
  if (paper.publicationClass === "published_track_unknown") {
    return "Published · track unresolved";
  }
  if (paper.publicationClass?.startsWith("verified_")) {
    return paper.publicationClass
      .replace(/^verified_/, "Verified ")
      .replace(/_/g, " ");
  }
  if (
    ["preprint_only", "under_review_or_submission"].includes(
      paper.publicationClass || "",
    )
  ) {
    return "Frontier signal · not archival verification";
  }
  return "Publication status could not be verified";
}

function appendReviewInsight(
  doc: Document,
  parent: HTMLElement,
  paper: RecommendedPaper,
) {
  if (!paper.reviewInsight) return;
  const details = doc.createElement("details");
  details.className = "pp-review-insight";
  const summary = doc.createElement("summary");
  summary.textContent = "Public review insights";
  details.appendChild(summary);
  const sections = [
    ["Valued strengths", paper.reviewInsight.valuedStrengths],
    ["Concerns", paper.reviewInsight.concerns],
    ["Reviewer priorities", paper.reviewInsight.reviewerPriorities],
    ["Disagreements", paper.reviewInsight.disagreements],
    ["Limits", paper.reviewInsight.limitations],
  ] as const;
  for (const [label, values] of sections) {
    if (!values.length) continue;
    const heading = doc.createElement("strong");
    heading.textContent = label;
    const list = doc.createElement("ul");
    for (const value of values) {
      const item = doc.createElement("li");
      item.textContent = value;
      list.appendChild(item);
    }
    details.append(heading, list);
  }
  parent.appendChild(details);
}

function actionButton(params: {
  doc: Document;
  label: string;
  className: string;
  onClick(): void | Promise<void>;
  onError(error: unknown): void;
}) {
  const button = params.doc.createElement("button");
  button.className = params.className;
  button.textContent = params.label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await params.onClick();
    } catch (error) {
      params.onError(error);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

export function buildDiscoveryRow(params: {
  doc: Document;
  paper: RecommendedPaper;
  actions: DiscoveryRowActions;
  reviewInsightsVisible?: boolean;
  canViewReviewInsights?: () => boolean;
  reviewInsightRunning?: boolean;
}) {
  const { doc, paper, actions } = params;
  const row = doc.createElement("div");
  row.setAttribute("role", "group");
  row.className = "pp-recommendation-row";
  const info = doc.createElement("div");
  info.className = "pp-recommendation-row__info";

  const title = doc.createElement("button");
  title.type = "button";
  title.textContent = paper.title;
  title.className = "pp-recommendation-row__title";
  title.addEventListener("click", () => {
    void Promise.resolve(actions.onOpen(paper)).catch(actions.onError);
  });
  info.appendChild(title);

  const meta = doc.createElement("div");
  meta.textContent = buildRecommendationMetadataLine(paper);
  meta.className = "pp-recommendation-row__meta";
  info.appendChild(meta);
  const badges = doc.createElement("div");
  badges.className = "pp-recommendation-row__badges";
  const publication = doc.createElement("span");
  publication.className = "pp-chip";
  publication.textContent = publicationBadge(paper);
  const venue = doc.createElement("span");
  venue.className = "pp-chip";
  venue.textContent = paper.leadingVenueAssessment
    ? `Leading venue · agent-assessed (${paper.leadingVenueAssessment.confidence})`
    : "Venue standing · not assessed";
  const confidence = doc.createElement("span");
  confidence.className = "pp-chip";
  confidence.textContent = `${paper.evidenceConfidence || "none"} evidence confidence`;
  badges.append(publication, venue, confidence);
  info.appendChild(badges);
  if (paper.reason) {
    const reason = doc.createElement("div");
    reason.textContent = paper.reason;
    reason.className = "pp-recommendation-row__reason";
    info.appendChild(reason);
  }
  if (paper.keyDifference) {
    const difference = doc.createElement("div");
    difference.textContent = `Key difference: ${paper.keyDifference}`;
    difference.className = "pp-recommendation-row__reason";
    info.appendChild(difference);
  }
  if (params.reviewInsightsVisible !== false) {
    appendReviewInsight(doc, info, paper);
  }

  const buttons = doc.createElement("div");
  buttons.className = "pp-recommendation-row__actions";
  if (paper.existingItemID) {
    const chip = doc.createElement("span");
    chip.textContent = "In library";
    chip.className = "pp-chip pp-chip--library";
    buttons.appendChild(chip);
  }
  buttons.appendChild(
    actionButton({
      doc,
      label: "Open",
      className: "pp-btn pp-btn--ghost",
      onClick: () => actions.onOpen(paper),
      onError: actions.onError,
    }),
  );

  const evidence = paper.publicationEvidence?.find((entry) =>
    [
      "official_proceedings",
      "official_program",
      "official_decision",
      "publisher_proceedings",
      "official_anthology",
    ].includes(entry.type),
  );
  if (evidence) {
    const evidenceButton = actionButton({
      doc,
      label: "Evidence",
      className: "pp-btn pp-btn--ghost",
      onClick: () => actions.onOpenURL(evidence.url),
      onError: actions.onError,
    });
    evidenceButton.title = `${evidence.sourceName}: ${evidence.supports.join(", ")}`;
    buttons.appendChild(evidenceButton);
  } else {
    const evidenceStatus = actionButton({
      doc,
      label: "Evidence status",
      className: "pp-btn pp-btn--ghost",
      onClick: () => {
        throw new Error(
          "No direct official publication evidence is available for this result.",
        );
      },
      onError: actions.onError,
    });
    evidenceStatus.title = "No direct official publication evidence available";
    buttons.appendChild(evidenceStatus);
  }
  if (paper.reviewURL && params.reviewInsightsVisible !== false) {
    const requireLiveReviewGate = () => {
      if (params.canViewReviewInsights?.() === false) {
        throw new Error(
          "Complete Critical Read Steps 4–6 before viewing public review insights.",
        );
      }
    };
    if (!params.reviewInsightRunning) {
      buttons.appendChild(
        actionButton({
          doc,
          label: "Open reviews",
          className: "pp-btn pp-btn--ghost",
          onClick: () => {
            requireLiveReviewGate();
            return actions.onOpenURL(paper.reviewURL!);
          },
          onError: actions.onError,
        }),
      );
    }
    buttons.appendChild(
      actionButton({
        doc,
        label: params.reviewInsightRunning
          ? "Cancel review insights"
          : paper.reviewInsight
            ? "Refresh review insights"
            : "Review insights",
        className: "pp-btn pp-btn--secondary",
        onClick: () => {
          requireLiveReviewGate();
          return actions.onReviewInsight(paper);
        },
        onError: actions.onError,
      }),
    );
  }
  buttons.appendChild(
    actionButton({
      doc,
      label: "Add to collection",
      className: "pp-btn pp-btn--secondary",
      onClick: () => actions.onAdd(paper),
      onError: actions.onError,
    }),
  );
  row.append(info, buttons);
  return row;
}
