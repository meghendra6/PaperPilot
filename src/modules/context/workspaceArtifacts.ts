import type { ContextPayload } from "./types";

export function buildWorkspaceArtifacts(params: {
  title: string;
  authors: string[];
  year?: string;
  itemKey?: string;
  attachmentKey?: string;
  abstractNote?: string;
  fullText?: string;
  markdownText?: string;
  structuredContent?: unknown;
  extractionMethod?: string;
  extractionNotes?: string[];
  payload: ContextPayload;
  annotations?: string[];
  recentTurns: Array<{ role: string; text: string; createdAt: string }>;
}) {
  const paperText = [
    `Title: ${params.title}`,
    params.authors.length ? `Authors: ${params.authors.join(", ")}` : undefined,
    params.year ? `Year: ${params.year}` : undefined,
    params.itemKey ? `Item Key: ${params.itemKey}` : undefined,
    params.attachmentKey
      ? `Attachment Key: ${params.attachmentKey}`
      : undefined,
    params.abstractNote ? `Abstract: ${params.abstractNote}` : undefined,
    params.extractionMethod
      ? `Extraction Method: ${params.extractionMethod}`
      : undefined,
    params.extractionNotes?.length
      ? `Extraction Notes: ${params.extractionNotes.join(" | ")}`
      : undefined,
    params.markdownText
      ? `\nStructured Markdown\n${params.markdownText}`
      : params.fullText
        ? `\nFull Text\n${params.fullText}`
        : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const paperJson = {
    metadata: {
      title: params.title,
      authors: params.authors,
      year: params.year,
      itemKey: params.itemKey,
      attachmentKey: params.attachmentKey,
      abstractNote: params.abstractNote,
    },
    extractionMethod: params.extractionMethod || "zotero-attachment-text",
    extractionNotes: params.extractionNotes ?? [],
    document:
      params.structuredContent ??
      (params.fullText
        ? {
            type: "plain-text-fallback",
            content: params.fullText,
          }
        : undefined),
  };

  return {
    paperText,
    paperMarkdownText: params.markdownText || params.fullText || "",
    paperJson,
    contextIndexText: [
      "# Zotero Paper Workspace",
      "",
      "Use these files when answering:",
      "- paper.md — structured Markdown extracted from the PDF when available",
      "- paper.json — structured PDF extraction with layout metadata when available",
      "- paper.txt — compatibility text snapshot with metadata and extracted content",
      "- selection.json — current question context, selected text, page number, retrieved chunks",
      "- recent-turns.json — recent conversation turns for follow-up continuity",
      "- annotations.json — annotation ids related to this request",
      "- metadata.json — structured bibliographic metadata",
      "- figures/ — place image assets here when needed",
      "",
      "Reading order recommendation:",
      "1. CONTEXT_INDEX.md",
      "2. paper.md",
      "3. paper.json",
      "4. paper.txt",
      "5. selection.json",
      "6. recent-turns.json",
      "7. metadata.json / annotations.json as needed",
    ].join("\n"),
    metadata: {
      title: params.title,
      authors: params.authors,
      year: params.year,
      itemKey: params.itemKey,
      attachmentKey: params.attachmentKey,
      abstractNote: params.abstractNote,
      extractionMethod: params.extractionMethod,
      extractionNotes: params.extractionNotes ?? [],
    },
    selection: params.payload,
    annotations: params.annotations ?? [],
    recentTurns: params.recentTurns,
  };
}
