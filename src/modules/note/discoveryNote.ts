import type { DiscoveryResult, DiscoveredPaper } from "../discovery/types";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function paperMarkdown(paper: DiscoveredPaper, includeReviewInsights: boolean) {
  const evidence = paper.publicationEvidence
    .map(
      (entry) =>
        `  - ${entry.sourceName} (${entry.supports.join(", ")}): ${entry.url}`,
    )
    .join("\n");
  return [
    `- **${paper.title}**${paper.year ? ` (${paper.year})` : ""}`,
    `  - Publication class: ${paper.publicationClass}`,
    `  - Evidence confidence: ${paper.evidenceConfidence}`,
    `  - Relationship: ${paper.relationship}`,
    `  - Relevance: ${paper.relevanceReason}`,
    paper.keyDifference
      ? `  - Key difference: ${paper.keyDifference}`
      : undefined,
    evidence ? `  - Official/publication evidence:\n${evidence}` : undefined,
    includeReviewInsights && paper.reviewInsight
      ? [
          "  - Public review insight (summary only):",
          ...paper.reviewInsight.valuedStrengths.map(
            (value) => `    - Strength: ${value}`,
          ),
          ...paper.reviewInsight.concerns.map(
            (value) => `    - Concern: ${value}`,
          ),
          ...paper.reviewInsight.disagreements.map(
            (value) => `    - Disagreement: ${value}`,
          ),
          ...paper.reviewInsight.sourceURLs.map(
            (value) => `    - Source: ${value}`,
          ),
        ].join("\n")
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDiscoveryNoteMarkdown(params: {
  paperTitle: string;
  concern?: string;
  discovery: DiscoveryResult;
  includeReviewInsights?: boolean;
}) {
  const lane = (title: string, papers: DiscoveredPaper[]) =>
    [
      `## ${title}`,
      papers.length
        ? papers
            .map((paper) =>
              paperMarkdown(paper, params.includeReviewInsights !== false),
            )
            .join("\n")
        : "No papers met this lane's evidence criteria.",
    ].join("\n\n");
  return [
    `# Verified prior-work discovery: ${params.paperTitle}`,
    params.concern ? `Research concern: ${params.concern}` : undefined,
    `Primary field: ${params.discovery.plan.primaryField}`,
    params.discovery.plan.adjacentFields.length
      ? `Adjacent fields: ${params.discovery.plan.adjacentFields.join(", ")}`
      : undefined,
    `Search scope: ${params.discovery.plan.scopeSummary}`,
    lane("Verified main-conference papers", params.discovery.verifiedMain),
    lane("Other peer-reviewed work", params.discovery.otherPeerReviewed),
    lane("Frontier / novelty radar", params.discovery.noveltyRadar),
    params.discovery.limitations.length
      ? `## Search limitations\n\n${params.discovery.limitations.map((value) => `- ${value}`).join("\n")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildDiscoveryNoteHtml(params: {
  paperTitle: string;
  concern?: string;
  discovery: DiscoveryResult;
  includeReviewInsights?: boolean;
}) {
  return `<pre>${escapeHtml(buildDiscoveryNoteMarkdown(params))}</pre>`;
}

export async function saveDiscoveryToNote(params: {
  item: {
    id: number;
    libraryID: number;
    isAttachment?: () => boolean;
    parentItemID?: number | false;
  };
  paperTitle: string;
  concern?: string;
  discovery: DiscoveryResult;
  includeReviewInsights?: boolean;
}) {
  const zotero = (globalThis as { Zotero?: any }).Zotero;
  if (!zotero?.Item) throw new Error("Zotero note APIs are unavailable.");
  const parent =
    params.item.isAttachment?.() && params.item.parentItemID
      ? zotero.Items.get(params.item.parentItemID) || params.item
      : params.item.isAttachment?.()
        ? undefined
        : params.item;
  const note = new zotero.Item("note");
  note.libraryID = parent?.libraryID ?? params.item.libraryID;
  if (parent) note.parentID = parent.id;
  note.setNote(buildDiscoveryNoteHtml(params));
  await note.saveTx();
  return note;
}
