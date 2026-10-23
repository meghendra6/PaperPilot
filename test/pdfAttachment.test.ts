import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isPdfFileAttachment } from "../src/utils/pdfAttachment";

const zoteroAttachment = (params: {
  file: boolean;
  type: string;
  filename?: string;
}) => ({
  isPDFAttachment: () => params.file && params.type === "application/pdf",
  isFileAttachment: () => params.file,
  attachmentContentType: params.type,
  attachmentFilename: params.filename ?? "",
});

test("a linked URL never counts as the paper's PDF", () => {
  // Zotero leaves the type empty for a link whose URL lacks .pdf.
  assert.equal(
    isPdfFileAttachment(zoteroAttachment({ file: false, type: "" })),
    false,
  );
  // A link ending in .pdf gets application/pdf but is still not a file.
  assert.equal(
    isPdfFileAttachment(
      zoteroAttachment({ file: false, type: "application/pdf" }),
    ),
    false,
  );
});

test("stored PDFs count, and an untyped file only with a .pdf name", () => {
  assert.equal(
    isPdfFileAttachment(
      zoteroAttachment({ file: true, type: "application/pdf" }),
    ),
    true,
  );
  assert.equal(
    isPdfFileAttachment(
      zoteroAttachment({ file: true, type: "", filename: "paper.PDF" }),
    ),
    true,
  );
  assert.equal(
    isPdfFileAttachment(
      zoteroAttachment({ file: true, type: "", filename: "notes.txt" }),
    ),
    false,
  );
  assert.equal(isPdfFileAttachment(undefined), false);
});
