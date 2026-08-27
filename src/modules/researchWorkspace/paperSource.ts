import { paperWorkspaceContentCache } from "../tools/paperWorkspaceContent";

declare const Zotero: any;

export interface ResearchWorkspacePaper {
  paperKey: string;
  itemID: number;
  attachmentID: number;
  attachmentKey: string;
  title: string;
  context: string;
  extractionQuality: "structured" | "zotero_text";
  structuredContent?: unknown;
  structuredChunks?: ResearchWorkspaceStructuredChunk[];
}

export interface ResearchWorkspaceStructuredChunk {
  id: string;
  title?: string;
  text: string;
  attachmentKey: string;
  pageIndex?: number;
  sectionPath?: string[];
  metadata: {
    paperKey: string;
    elementId?: string;
    elementType?: string;
    boundingBox?: unknown;
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function buildOpenDataLoaderHybridChunks(params: {
  paperKey: string;
  attachmentKey: string;
  structuredContent: unknown;
}) {
  const chunks: ResearchWorkspaceStructuredChunk[] = [];
  const sectionPath: string[] = [];
  let ordinal = 0;

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const node = record(value);
    if (!node) return;
    const content = typeof node.content === "string" ? node.content.trim() : "";
    const elementType =
      typeof node.type === "string" ? node.type.trim() : undefined;
    if (content && elementType === "heading") {
      const level = Number(node["heading level"]);
      const index = Number.isInteger(level)
        ? Math.max(0, Math.min(5, level - 1))
        : 0;
      sectionPath.splice(index);
      sectionPath[index] = content;
    }
    if (content) {
      const pageNumber = Number(node["page number"]);
      const elementId =
        typeof node.id === "string" || typeof node.id === "number"
          ? String(node.id)
          : undefined;
      chunks.push({
        id: `${params.paperKey}:${params.attachmentKey}:element-${elementId || ordinal}`,
        ...(sectionPath.length
          ? {
              title: sectionPath[sectionPath.length - 1],
              sectionPath: [...sectionPath],
            }
          : {}),
        text: content,
        attachmentKey: params.attachmentKey,
        ...(Number.isInteger(pageNumber) && pageNumber > 0
          ? { pageIndex: pageNumber - 1 }
          : {}),
        metadata: {
          paperKey: params.paperKey,
          ...(elementId ? { elementId } : {}),
          ...(elementType ? { elementType } : {}),
          ...(node["bounding box"]
            ? { boundingBox: node["bounding box"] }
            : {}),
        },
      });
      ordinal += 1;
    }
    if (Array.isArray(node.kids)) visit(node.kids);
  };

  visit(params.structuredContent);
  return chunks;
}

async function getItem(itemID: number) {
  if (typeof Zotero.Items?.getAsync === "function") {
    return Zotero.Items.getAsync(itemID);
  }
  return Zotero.Items?.get?.(itemID);
}

async function resolvePaperAndAttachment(item: any) {
  if (item?.isAttachment?.()) {
    const isPdf =
      item.isPDFAttachment?.() ||
      item.attachmentContentType === "application/pdf" ||
      item.attachmentContentType === "";
    if (!isPdf) throw new Error("The selected attachment is not a PDF.");
    const parentID = Number(item.parentItemID || 0);
    return {
      paperItem: parentID ? (await getItem(parentID)) || item : item,
      attachment: item,
    };
  }

  const attachmentIDs = item?.getAttachments?.() ?? [];
  for (const attachmentID of attachmentIDs) {
    const attachment = await getItem(Number(attachmentID));
    if (
      attachment?.isPDFAttachment?.() ||
      attachment?.attachmentContentType === "application/pdf" ||
      attachment?.attachmentContentType === ""
    ) {
      return { paperItem: item, attachment };
    }
  }
  throw new Error("No PDF attachment found for this item.");
}

export async function loadResearchWorkspacePaper(
  item: any,
  maxCharacters = 1_500_000,
): Promise<ResearchWorkspacePaper> {
  const { paperItem, attachment } = await resolvePaperAndAttachment(item);
  const content = await paperWorkspaceContentCache.getPaperContent(paperItem);
  const context = String(content.markdownText || content.fullText || "").slice(
    0,
    Math.max(10_000, maxCharacters),
  );
  if (!context.trim()) {
    throw new Error("No readable paper text could be extracted.");
  }

  const paperKey = String(paperItem.key || paperItem.id);
  const attachmentKey = String(attachment.key || attachment.id);
  return {
    paperKey,
    itemID: Number(paperItem.id),
    attachmentID: Number(attachment.id),
    attachmentKey,
    title: String(paperItem.getField?.("title") || "Untitled paper"),
    context,
    extractionQuality:
      content.extractionMethod === "opendataloader-pdf"
        ? "structured"
        : "zotero_text",
    ...(content.structuredContent
      ? {
          structuredContent: content.structuredContent,
          structuredChunks: buildOpenDataLoaderHybridChunks({
            paperKey,
            attachmentKey,
            structuredContent: content.structuredContent,
          }),
        }
      : {}),
  };
}

export async function loadSelectedResearchWorkspacePapers(
  maxCharacters = 1_500_000,
) {
  const selected = Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() ?? [];
  const papers: ResearchWorkspacePaper[] = [];
  const seen = new Set<string>();
  for (const item of selected.slice(0, 12)) {
    try {
      const paper = await loadResearchWorkspacePaper(item, maxCharacters);
      if (seen.has(paper.paperKey)) continue;
      seen.add(paper.paperKey);
      papers.push(paper);
    } catch {
      // Ignore selected rows without a readable PDF; the caller still enforces
      // the two-paper minimum after loading.
    }
  }
  return papers;
}
