import {
  buildRecommendationMetadataLine,
  type RecommendedPaper,
} from "../relatedRecommendations";
import { isPublicReviewURL } from "../discovery/normalize";

export interface DiscoveryRowActions {
  onOpen(paper: RecommendedPaper): void | Promise<void>;
  onSaveCandidate?(paper: RecommendedPaper): void | Promise<void>;
  onAdd(paper: RecommendedPaper): void | Promise<void>;
  onOpenURL(url: string): void;
  onReviewInsight(paper: RecommendedPaper): void | Promise<void>;
  onError(error: unknown): void;
  /**
   * Records an error already shown inside its row, so the pane status keeps
   * it after the next rebuild. It must not rebuild the rows itself.
   */
  onRowError?(error: unknown): void;
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
  for (const [label, value] of [
    ["Author response / revision", paper.reviewInsight.authorResponseContext],
    ["Decision context", paper.reviewInsight.decisionContext],
  ] as const) {
    if (!value) continue;
    const heading = doc.createElement("strong");
    heading.textContent = label;
    const paragraph = doc.createElement("p");
    paragraph.textContent = value;
    details.append(heading, paragraph);
  }
  parent.appendChild(details);
}

function actionButton(params: {
  doc: Document;
  label: string;
  className: string;
  onClick(): void | Promise<void>;
  onError(error: unknown): void;
  /** Keeps the button disabled and explains why in its tooltip. */
  disabledReason?: string;
  /** Stable key for focus restore; the label can change between renders. */
  action?: string;
  onStart?(): void;
}) {
  const button = params.doc.createElement("button");
  button.className = params.className;
  button.textContent = params.label;
  if (params.action) button.dataset.rowAction = params.action;
  if (params.disabledReason) {
    button.disabled = true;
    button.title = params.disabledReason;
  }
  button.addEventListener("click", async () => {
    params.onStart?.();
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
  /** Set while another paper's review insights run. */
  reviewInsightBlockedReason?: string;
}) {
  const { doc, paper, actions } = params;
  const row = doc.createElement("div");
  row.setAttribute("role", "group");
  row.className = "pp-recommendation-row";
  // Focus can fall back to the row after a rebuild; it is not a tab stop.
  row.tabIndex = -1;
  // A row action's error shows in its own row; the pane status sits above
  // every lane and is off screen for a row far down. A row that a rebuild
  // already replaced falls back to that status.
  const rowError = doc.createElement("div");
  rowError.className = "pp-recommendation-row__error";
  rowError.setAttribute("role", "status");
  rowError.hidden = true;
  const onRowError = (error: unknown) => {
    if (!row.isConnected) {
      actions.onError(error);
      return;
    }
    rowError.textContent =
      error instanceof Error
        ? error.message
        : "The action could not be completed.";
    rowError.hidden = false;
    actions.onRowError?.(error);
  };
  // A new action replaces the previous error of this row.
  const clearRowError = () => {
    rowError.hidden = true;
    rowError.textContent = "";
  };
  const info = doc.createElement("div");
  info.className = "pp-recommendation-row__info";

  const title = doc.createElement("button");
  title.type = "button";
  title.textContent = paper.title;
  title.className = "pp-recommendation-row__title";
  title.dataset.rowAction = "title";
  title.addEventListener("click", () => {
    clearRowError();
    void Promise.resolve(actions.onOpen(paper)).catch(onRowError);
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
      action: "open",
      className: "pp-btn pp-btn--ghost",
      onClick: () => actions.onOpen(paper),
      onError: onRowError,
      onStart: clearRowError,
    }),
  );

  const evidence = paper.publicationEvidence?.find(
    (entry) =>
      [
        "official_proceedings",
        "official_program",
        "official_decision",
        "publisher_proceedings",
        "official_anthology",
      ].includes(entry.type) &&
      (params.reviewInsightsVisible !== false ||
        !isPublicReviewURL(entry.url, paper.reviewURL)),
  );
  if (evidence) {
    const evidenceButton = actionButton({
      doc,
      label: "Evidence",
      action: "evidence",
      className: "pp-btn pp-btn--ghost",
      onClick: () => {
        if (
          isPublicReviewURL(evidence.url, paper.reviewURL) &&
          params.canViewReviewInsights?.() === false
        ) {
          throw new Error(
            "Complete Critical Read Steps 4–6 before opening public review sources.",
          );
        }
        return actions.onOpenURL(evidence.url);
      },
      onError: onRowError,
      onStart: clearRowError,
    });
    evidenceButton.title = `${evidence.sourceName}: ${evidence.supports.join(", ")}`;
    buttons.appendChild(evidenceButton);
  } else {
    // A status, not an action: the old button could only report an error.
    const noEvidence = doc.createElement("span");
    noEvidence.className = "pp-chip";
    noEvidence.textContent = "No official evidence";
    noEvidence.title =
      "No direct official publication evidence is available for this result.";
    buttons.appendChild(noEvidence);
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
          action: "open-reviews",
          className: "pp-btn pp-btn--ghost",
          onClick: () => {
            requireLiveReviewGate();
            return actions.onOpenURL(paper.reviewURL!);
          },
          onError: onRowError,
          onStart: clearRowError,
        }),
      );
    }
    buttons.appendChild(
      actionButton({
        doc,
        action: "review-insight",
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
        onError: onRowError,
        onStart: clearRowError,
        disabledReason: params.reviewInsightRunning
          ? undefined
          : params.reviewInsightBlockedReason,
      }),
    );
  }
  buttons.appendChild(
    actionButton({
      doc,
      label: "Add to collection",
      action: "add-to-collection",
      className: "pp-btn pp-btn--secondary",
      onClick: () => actions.onAdd(paper),
      onError: onRowError,
      onStart: clearRowError,
    }),
  );
  if (actions.onSaveCandidate)
    buttons.appendChild(
      actionButton({
        doc,
        label: "Save candidate",
        action: "save-candidate",
        className: "pp-btn pp-btn--secondary",
        onClick: () => actions.onSaveCandidate!(paper),
        onError: onRowError,
        onStart: clearRowError,
      }),
    );
  info.appendChild(rowError);
  row.append(info, buttons);
  return row;
}
