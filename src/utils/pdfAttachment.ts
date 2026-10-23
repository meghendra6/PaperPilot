interface AttachmentLike {
  isPDFAttachment?: () => boolean;
  isFileAttachment?: () => boolean;
  attachmentContentType?: string;
  attachmentFilename?: string;
}

/**
 * Whether an attachment is a PDF file Paper Pilot can read. A "Link to URI"
 * attachment is not: Zotero leaves its content type empty unless the URL
 * ends in .pdf, and it has no local file. An untyped file attachment counts
 * only when its file name ends in .pdf.
 */
export function isPdfFileAttachment(value: unknown): boolean {
  const attachment = value as AttachmentLike | null | undefined;
  if (!attachment) return false;
  if (attachment.isPDFAttachment?.()) return true;
  const type = String(attachment.attachmentContentType ?? "");
  if (typeof attachment.isFileAttachment === "function") {
    if (!attachment.isFileAttachment()) return false;
    return (
      type === "" && /\.pdf$/i.test(String(attachment.attachmentFilename ?? ""))
    );
  }
  // Without Zotero's item API, fall back to the declared content type.
  if (typeof attachment.isPDFAttachment === "function") return false;
  return type === "application/pdf";
}
