import {
  paperWorkspaceContentCache,
  type PaperContentFingerprint,
} from "../tools/paperWorkspaceContent";
import {
  buildZoteroSourceID,
  createZoteroSourceIdentity,
  sameZoteroSource,
  type ZoteroSourceIdentity,
} from "./sourceIdentity";

declare const Zotero: any;

export interface ResearchWorkspacePaper {
  sourceID: string;
  paperKey: string;
  libraryID: number;
  itemKey: string;
  itemID: number;
  attachmentID: number;
  attachmentKey: string;
  contentFingerprint: PaperContentFingerprint;
  title: string;
  creators?: string[];
  year?: number;
  doi?: string;
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
export interface ResearchWorkspaceResolvedSource {
  sourceID: string;
  libraryID: number;
  itemID: number;
  itemKey: string;
  attachmentID: number;
  attachmentKey: string;
  title: string;
  paperItem: any;
  attachment: any;
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

export async function getResearchWorkspaceItem(itemID: number) {
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
      paperItem: parentID
        ? (await getResearchWorkspaceItem(parentID)) || item
        : item,
      attachment: item,
    };
  }

  const attachments: any[] = [];
  const attachmentIDs = item?.getAttachments?.() ?? [];
  for (const attachmentID of attachmentIDs) {
    const attachment = await getResearchWorkspaceItem(Number(attachmentID));
    if (
      attachment?.isPDFAttachment?.() ||
      attachment?.attachmentContentType === "application/pdf" ||
      attachment?.attachmentContentType === ""
    ) {
      attachments.push(attachment);
    }
  }
  if (attachments.length > 1) {
    throw new Error(
      "Multiple PDF attachments found. Select the exact PDF attachment row.",
    );
  }
  if (attachments.length === 1) {
    return { paperItem: item, attachment: attachments[0] };
  }
  throw new Error("No PDF attachment found for this item.");
}

export async function resolveResearchWorkspaceSource(
  item: any,
): Promise<ResearchWorkspaceResolvedSource> {
  if (!item) throw new Error("The selected Zotero item is unavailable.");
  const { paperItem, attachment } = await resolvePaperAndAttachment(item);
  const identity = createZoteroSourceIdentity({
    libraryID: attachment.libraryID ?? paperItem.libraryID,
    itemKey: paperItem.key ?? paperItem.id,
    attachmentKey: attachment.key ?? attachment.id,
    standaloneAttachment: Number(paperItem.id) === Number(attachment.id),
  });
  return {
    sourceID: buildZoteroSourceID(identity),
    libraryID: identity.libraryID,
    itemID: Number(paperItem.id),
    itemKey: identity.itemKey,
    attachmentID: Number(attachment.id),
    attachmentKey: identity.attachmentKey,
    title: String(paperItem.getField?.("title") || "Untitled paper"),
    paperItem,
    attachment,
  };
}

export async function loadResearchWorkspacePaper(
  item: any,
  maxCharacters = 1_500_000,
): Promise<ResearchWorkspacePaper> {
  const resolved = await resolveResearchWorkspaceSource(item);
  const { paperItem, attachment, sourceID } = resolved;
  const identity = createZoteroSourceIdentity({
    libraryID: resolved.libraryID,
    itemKey: resolved.itemKey,
    attachmentKey: resolved.attachmentKey,
    standaloneAttachment: resolved.itemID === resolved.attachmentID,
  });
  const content = await paperWorkspaceContentCache.getPaperContent(paperItem, {
    attachment,
    source: identity,
  });
  if (
    !content.source ||
    !content.contentFingerprint ||
    !sameZoteroSource(content.source as ZoteroSourceIdentity, identity)
  ) {
    throw new Error(
      "Extracted paper content does not match the selected Zotero attachment.",
    );
  }
  const context = String(content.markdownText || content.fullText || "").slice(
    0,
    Math.max(10_000, maxCharacters),
  );
  if (!context.trim()) {
    throw new Error("No readable paper text could be extracted.");
  }

  const paperKey = sourceID;
  const itemKey = resolved.itemKey;
  const attachmentKey = resolved.attachmentKey;
  const creators =
    typeof paperItem.getCreators === "function"
      ? paperItem
          .getCreators()
          .map((creator: any) =>
            [creator.firstName, creator.lastName].filter(Boolean).join(" "),
          )
          .filter(Boolean)
      : [];
  const yearMatch = String(
    paperItem.getField?.("year") || paperItem.getField?.("date") || "",
  ).match(/\b\d{4}\b/);
  const doi = String(paperItem.getField?.("DOI") || "").trim();
  return {
    sourceID,
    paperKey,
    libraryID: identity.libraryID,
    itemKey,
    itemID: resolved.itemID,
    attachmentID: resolved.attachmentID,
    attachmentKey,
    contentFingerprint: content.contentFingerprint,
    title: resolved.title,
    ...(creators.length ? { creators } : {}),
    ...(yearMatch ? { year: Number(yearMatch[0]) } : {}),
    ...(doi ? { doi } : {}),
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
