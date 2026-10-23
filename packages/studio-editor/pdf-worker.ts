// A self-contained classic worker also starts in Chromium's opaque-origin
// sandbox, where a blob module worker cannot pass its module fetch check.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
