class PDFTextCache {
  private pdfText: string | null = null;
  private currentItemID: string | null = null;

  async getPDFText(item: Zotero.Item): Promise<string> {
    const itemID = item.id;

    if (this.currentItemID !== itemID.toString() || this.pdfText === null) {
      this.pdfText = await this.extractPDFText(item);
      this.currentItemID = itemID.toString();
    }

    return this.pdfText;
  }

  private async extractPDFText(item: Zotero.Item): Promise<string> {
    if (item.isAttachment()) {
      if (
        item.attachmentContentType === "application/pdf" ||
        item.attachmentContentType === ""
      ) {
        return await item.attachmentText;
      }
      throw new Error("Attachment is not a PDF");
    }

    const attachments = item.getAttachments();
    for (const attachmentID of attachments) {
      const attachment = Zotero.Items.get(attachmentID);
      if (
        attachment.attachmentContentType === "application/pdf" ||
        attachment.attachmentContentType === ""
      ) {
        return await attachment.attachmentText;
      }
    }
    throw new Error("No PDF attachment found for this item");
  }

  clearCache() {
    this.pdfText = null;
    this.currentItemID = null;
  }
}

export const pdfTextCache = new PDFTextCache();
