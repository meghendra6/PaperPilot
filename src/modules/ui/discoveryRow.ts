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
  appendReviewInsight(doc, info, paper);

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
  }
  if (paper.reviewURL) {
    buttons.appendChild(
      actionButton({
        doc,
        label: "Open reviews",
        className: "pp-btn pp-btn--ghost",
        onClick: () => actions.onOpenURL(paper.reviewURL!),
        onError: actions.onError,
      }),
    );
    buttons.appendChild(
      actionButton({
        doc,
        label: paper.reviewInsight
          ? "Refresh review insights"
          : "Review insights",
        className: "pp-btn pp-btn--secondary",
        onClick: () => actions.onReviewInsight(paper),
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
