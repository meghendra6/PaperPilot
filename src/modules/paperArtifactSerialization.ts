import type { PaperArtifactCard, PaperArtifactKind } from "./paperArtifacts";
import type { ResearchBriefQuery } from "./researchBrief";

export interface SerializedPaperArtifactSection {
  heading: string;
  items: string[];
  evidence?: "explicit" | "inference" | "mixed";
}

export interface SerializedPaperArtifact {
  schemaVersion: 1;
  kind: PaperArtifactKind;
  title: string;
  summary: string;
  sections: SerializedPaperArtifactSection[];
  searchQueries: ResearchBriefQuery[];
  sourceLabel: string;
  updatedAt: string;
}

export interface SerializedPaperArtifactExport {
  schemaVersion: 1;
  exportKind: "collection-linked-artifact-set";
  sourceItemID: number;
  collectionID: number;
  exportedAt: string;
  artifacts: SerializedPaperArtifact[];
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeList(values: string[]) {
  return values.map((value) => normalizeText(value)).filter(Boolean);
}

export function serializePaperArtifactCard(
  card: PaperArtifactCard,
): SerializedPaperArtifact {
  return {
    schemaVersion: 1,
    kind: card.kind,
    title: normalizeText(card.title),
    summary: normalizeText(card.summary),
    sections: card.sections
      .map((section) => ({
        heading: normalizeText(section.heading),
        items: normalizeList(section.items),
        ...(section.evidence ? { evidence: section.evidence } : {}),
      }))
      .filter((section) => section.heading && section.items.length),
    searchQueries: (card.searchQueries || [])
      .map((entry) => ({
        query: normalizeText(entry.query),
        ...(entry.rationale
          ? { rationale: normalizeText(entry.rationale) }
          : {}),
      }))
      .filter((entry) => entry.query),
    sourceLabel: normalizeText(card.sourceLabel),
    updatedAt: card.updatedAt,
  };
}

export function serializePaperArtifactCards(cards: PaperArtifactCard[]) {
  return cards.map((card) => serializePaperArtifactCard(card));
}

export function buildPaperArtifactExportPayload(params: {
  sourceItemID: number;
  collectionID: number;
  cards: PaperArtifactCard[];
  exportedAt?: string;
}): SerializedPaperArtifactExport {
  return {
    schemaVersion: 1,
    exportKind: "collection-linked-artifact-set",
    sourceItemID: params.sourceItemID,
    collectionID: params.collectionID,
    exportedAt: params.exportedAt || new Date().toISOString(),
    artifacts: serializePaperArtifactCards(params.cards),
  };
}

export function buildPaperArtifactMarkdown(card: PaperArtifactCard) {
  const serialized = serializePaperArtifactCard(card);
  const lines = [
    `# ${serialized.title}`,
    "",
    serialized.summary,
    "",
    `Source note: ${serialized.sourceLabel}`,
  ];

  for (const section of serialized.sections) {
    lines.push("", `## ${section.heading}`);
    if (section.evidence) {
      lines.push(`Evidence label: ${section.evidence}`);
    }
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
  }

  if (serialized.searchQueries.length) {
    lines.push("", "## Suggested search queries");
    for (const query of serialized.searchQueries) {
      lines.push(
        `- ${query.query}${query.rationale ? ` — ${query.rationale}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}
