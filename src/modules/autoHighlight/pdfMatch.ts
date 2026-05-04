import type { MatchedHighlight, PDFPageText, PDFTextSpan } from "./types";
import { buildCodexCommandEnvironment } from "../codex/environment";
import { shellEscape } from "../codex/shell";

async function dynamicImportPdfJs() {
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<Record<string, unknown>>;
  return dynamicImport("pdfjs-dist/legacy/build/pdf.mjs");
}

function fileURLToPathString(fileUrl: string) {
  return decodeURIComponent(new URL(fileUrl).pathname);
}

async function pathExists(path: string) {
  try {
    const ioUtils = (
      globalThis as typeof globalThis & {
        IOUtils?: { exists?: (path: string) => Promise<boolean> };
      }
    ).IOUtils;
    if (ioUtils?.exists) {
      return await ioUtils.exists(path);
    }
  } catch {
    // ignore
  }
  return false;
}

export async function resolvePdfJsModuleSpecifier(options?: {
  rootUri?: string;
  exists?: (path: string) => Promise<boolean>;
}) {
  const exists = options?.exists ?? pathExists;
  const rootUri =
    options?.rootUri ??
    ((globalThis as typeof globalThis & { rootURI?: string }).rootURI || "");

  const candidates: string[] = [];
  if (rootUri.startsWith("file:")) {
    const normalizedRootUri = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
    const searchRoots = [
      new URL(".", normalizedRootUri),
      new URL("../", normalizedRootUri),
      new URL("../../", normalizedRootUri),
      new URL("../../../", normalizedRootUri),
    ];
    for (const base of searchRoots) {
      candidates.push(
        fileURLToPathString(
          new URL("node_modules/pdfjs-dist/legacy/build/pdf.mjs", base).href,
        ),
      );
    }
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return new URL(`file://${candidate}`).href;
    }
  }

  return "pdfjs-dist/legacy/build/pdf.mjs";
}

async function readBinary(filePath: string) {
  const zoteroFile = (globalThis as { Zotero?: any }).Zotero?.File;
  if (zoteroFile?.getBinaryContentsAsync) {
    const contents = await Promise.resolve(
      zoteroFile.getBinaryContentsAsync(filePath),
    );
    const bytes = new Uint8Array(String(contents || "").length);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = String(contents || "").charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<Record<string, unknown>>;
  const fs = (await dynamicImport("node:fs")) as {
    readFileSync: (path: string) => any;
  };
  const buffer = fs.readFileSync(filePath);
  if (buffer instanceof Uint8Array) {
    return new Uint8Array(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    );
  }
  return new Uint8Array(buffer);
}

export function normalizeQuoteText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00ad/g, "")
    .replace(/[^0-9a-z가-힣]+/gi, "")
    .toLowerCase()
    .trim();
}

function toRect(item: {
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  str?: unknown;
}) {
  if (!Array.isArray(item.transform) || typeof item.str !== "string") {
    return undefined;
  }
  const transform = item.transform as number[];
  if (transform.length < 6) {
    return undefined;
  }

  const x = Number(transform[4] || 0);
  const y = Number(transform[5] || 0);
  const width = Number(item.width || 0);
  const height = Math.abs(
    Number(item.height || transform[3] || transform[0] || 0),
  );

  if (!item.str.trim() || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return [x, y, x + width, y + height];
}

async function extractTextContentFromPageLike(pageLike: {
  getTextContent?: () => Promise<{ items: Array<Record<string, unknown>> }>;
  pdfPage?: {
    getTextContent?: () => Promise<{ items: Array<Record<string, unknown>> }>;
  };
}) {
  if (typeof pageLike.getTextContent === "function") {
    return pageLike.getTextContent();
  }
  if (typeof pageLike.pdfPage?.getTextContent === "function") {
    return pageLike.pdfPage.getTextContent();
  }
  throw new Error("Resolved PDF page object does not expose getTextContent().");
}

function buildSpansFromTextContent(
  textContent: { items: Array<Record<string, unknown>> },
  pageIndex: number,
) {
  return textContent.items
    .map((item): PDFTextSpan | undefined => {
      const text = typeof item.str === "string" ? item.str : "";
      const rect = toRect(item);
      const normalizedText = normalizeQuoteText(text);
      if (!text.trim() || !rect || !normalizedText) {
        return undefined;
      }
      return {
        pageIndex,
        pageLabel: String(pageIndex + 1),
        text,
        normalizedText,
        rect,
      };
    })
    .filter((item): item is PDFTextSpan => Boolean(item));
}

export async function extractPdfTextPagesFromPdfDocument(pdfDocument: {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getTextContent?: () => Promise<{ items: Array<Record<string, unknown>> }>;
    pdfPage?: {
      getTextContent?: () => Promise<{ items: Array<Record<string, unknown>> }>;
    };
  }>;
}): Promise<PDFPageText[]> {
  const pages: PDFPageText[] = [];
  for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
    const page = await pdfDocument.getPage(pageIndex + 1);
    const textContent = await extractTextContentFromPageLike(page);
    const spans = buildSpansFromTextContent(textContent, pageIndex);

    pages.push({
      pageIndex,
      pageLabel: String(pageIndex + 1),
      spans,
    });
  }
  return pages;
}

export async function extractPdfTextPagesFromReader(reader: {
  _initPromise: Promise<unknown>;
  _internalReader: {
    _primaryView: {
      initializedPromise: Promise<unknown>;
      _iframeWindow?: {
        PDFViewerApplication?: {
          pagesCount?: number;
          pdfViewer?: {
            getPageView?: (pageIndex: number) => {
              pdfPage?: {
                getTextContent?: () => Promise<{
                  items: Array<Record<string, unknown>>;
                }>;
              };
            };
            _pages?: Array<{
              pdfPage?: {
                getTextContent?: () => Promise<{
                  items: Array<Record<string, unknown>>;
                }>;
              };
            }>;
          };
          pdfDocument?: {
            numPages: number;
            getPage: (pageNumber: number) => Promise<{
              getTextContent: () => Promise<{
                items: Array<Record<string, unknown>>;
              }>;
            }>;
          };
        };
      };
    };
  };
}) {
  await reader._initPromise;
  await reader._internalReader._primaryView.initializedPromise;
  const application =
    reader._internalReader._primaryView._iframeWindow?.PDFViewerApplication;
  const pdfViewer = application?.pdfViewer;
  if (pdfViewer) {
    const pagesCount = application?.pagesCount || pdfViewer._pages?.length || 0;
    const pages: PDFPageText[] = [];
    for (let pageIndex = 0; pageIndex < pagesCount; pageIndex += 1) {
      const pageView =
        pdfViewer.getPageView?.(pageIndex) || pdfViewer._pages?.[pageIndex];
      if (!pageView) {
        continue;
      }
      const textContent = await extractTextContentFromPageLike(pageView);
      pages.push({
        pageIndex,
        pageLabel: String(pageIndex + 1),
        spans: buildSpansFromTextContent(textContent, pageIndex),
      });
    }
    if (pages.length) {
      return pages;
    }
  }

  const pdfDocument = application?.pdfDocument;
  if (!pdfDocument) {
    throw new Error(
      "Active Zotero PDF document is not available in the reader.",
    );
  }
  return extractPdfTextPagesFromPdfDocument(pdfDocument);
}

/**
 * Build a mapping from normalized char index to original NFKC char index.
 * Mirrors the exact normalizeQuoteText pipeline: first strip bracket groups
 * on the full string, then filter individual characters. The returned array
 * maps each normalized position to its corresponding position in the
 * NFKC-normalized original text.
 */
export function buildNormalizedToOriginalMap(original: string): number[] {
  const nfkc = original.normalize("NFKC");

  // Step 1: strip matched bracket groups (mirrors normalizeQuoteText regex)
  // and build NFKC-index mapping for surviving chars
  const bracketRanges = new Set<number>();
  const bracketRegex = /\[[^\]]*\]/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRegex.exec(nfkc)) !== null) {
    for (let j = m.index; j < m.index + m[0].length; j++) {
      bracketRanges.add(j);
    }
  }
  const afterBrackets: { ch: string; origIndex: number }[] = [];
  for (let i = 0; i < nfkc.length; i += 1) {
    if (!bracketRanges.has(i)) {
      afterBrackets.push({ ch: nfkc[i], origIndex: i });
    }
  }

  // Step 2: for each surviving char, apply the same single-char transforms
  // and keep it only if it produces a non-empty result
  const map: number[] = [];
  for (const { ch, origIndex } of afterBrackets) {
    const replaced = ch
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/\u00ad/g, "")
      .replace(/[^0-9a-z가-힣]/gi, "")
      .toLowerCase();
    if (replaced) {
      map.push(origIndex);
    }
  }
  return map;
}

function buildPageIndex(page: PDFPageText) {
  let combined = "";
  const charToSpanIndex: number[] = [];
  const spanStartOffsets: number[] = [];

  page.spans.forEach((span, spanIndex) => {
    spanStartOffsets.push(combined.length);
    combined += span.normalizedText;
    charToSpanIndex.push(
      ...new Array(span.normalizedText.length).fill(spanIndex),
    );
  });

  return { combined, charToSpanIndex, spanStartOffsets };
}

async function extractPdfTextPagesInCurrentContext(
  filePath: string,
): Promise<PDFPageText[]> {
  const pdfjs = await dynamicImportPdfJs();
  const document = await (
    pdfjs.getDocument as (params: { data: any; disableWorker: boolean }) => {
      promise: Promise<any>;
    }
  )({
    data: await readBinary(filePath),
    disableWorker: true,
  }).promise;
  return extractPdfTextPagesFromPdfDocument(document);
}

async function extractPdfTextPagesViaSubprocess(
  filePath: string,
): Promise<PDFPageText[]> {
  const zoteroGlobal = globalThis as typeof globalThis & {
    Zotero?: {
      Utilities?: {
        Internal?: {
          subprocess?: (command: string, args?: string[]) => Promise<string>;
        };
      };
      getMainWindow?: () => Window | undefined;
    };
  };

  const subprocess = zoteroGlobal.Zotero?.Utilities?.Internal?.subprocess;
  if (typeof subprocess !== "function") {
    throw new Error("PDF extraction fallback subprocess is unavailable.");
  }

  const environment = buildCodexCommandEnvironment("/opt/homebrew/bin/node");
  const exports = Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
  const pdfjsSpecifier = await resolvePdfJsModuleSpecifier();
  const nodeScript = `
import fs from "node:fs";

function normalizeQuoteText(text) {
  return text
    .normalize("NFKC")
    .replace(/\\[[^\\]]*\\]/g, "")
    .replace(/[\\u2018\\u2019\\u201A\\u201B]/g, "'")
    .replace(/[\\u201C\\u201D\\u201E\\u201F]/g, '"')
    .replace(/[\\u2010-\\u2015]/g, "-")
    .replace(/\\u00ad/g, "")
    .replace(/[^0-9a-z가-힣]+/gi, "")
    .toLowerCase()
    .trim();
}

function toRect(item) {
  if (!Array.isArray(item.transform) || typeof item.str !== "string") return undefined;
  const transform = item.transform;
  if (transform.length < 6) return undefined;
  const x = Number(transform[4] || 0);
  const y = Number(transform[5] || 0);
  const width = Number(item.width || 0);
  const height = Math.abs(Number(item.height || transform[3] || transform[0] || 0));
  if (!item.str.trim() || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return [x, y, x + width, y + height];
}

const filePath = process.argv[2];
const pdfjsSpecifier = process.argv[3];
try {
  const pdfjs = await import(pdfjsSpecifier);
  const data = new Uint8Array(fs.readFileSync(filePath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const spans = textContent.items
      .map((item) => {
        const text = typeof item.str === "string" ? item.str : "";
        const rect = toRect(item);
        const normalizedText = normalizeQuoteText(text);
        if (!text.trim() || !rect || !normalizedText) return undefined;
        return { text, rect };
      })
      .filter(Boolean);
    pages.push({ pageIndex, pageLabel: String(pageIndex + 1), spans });
  }
  process.stdout.write(JSON.stringify({ ok: true, pages }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
}
`.trim();
  const output = await subprocess("/bin/zsh", [
    "-lc",
    [
      ...exports,
      `NODE_BIN="$(command -v node || true)"`,
      `if [ -z "$NODE_BIN" ]; then printf '%s' '{"ok":false,"error":"node executable not found in PATH"}'; exit 0; fi`,
      `OUT_FILE="$(mktemp)"`,
      `ERR_FILE="$(mktemp)"`,
      `"${"$"}NODE_BIN" --input-type=module - ${shellEscape(filePath)} ${shellEscape(pdfjsSpecifier)} >"${"$"}OUT_FILE" 2>"${"$"}ERR_FILE" <<'EOF'\n${nodeScript}\nEOF`,
      `STATUS=$?`,
      `STDOUT_CONTENT="$(cat "${"$"}OUT_FILE" 2>/dev/null || true)"`,
      `STDERR_CONTENT="$(cat "${"$"}ERR_FILE" 2>/dev/null || true)"`,
      `rm -f "${"$"}OUT_FILE" "${"$"}ERR_FILE"`,
      `if [ "${"$"}STATUS" -ne 0 ]; then`,
      `  ERROR_MESSAGE="${"$"}STDERR_CONTENT"`,
      `  if [ -z "${"$"}ERROR_MESSAGE" ]; then ERROR_MESSAGE="subprocess exited with status ${"$"}STATUS"; fi`,
      `  "${"$"}NODE_BIN" -e 'process.stdout.write(JSON.stringify({ok:false,error:process.argv[1]}))' "${"$"}ERROR_MESSAGE"`,
      `  exit 0`,
      `fi`,
      `if [ -z "${"$"}STDOUT_CONTENT" ]; then "${"$"}NODE_BIN" -e 'process.stdout.write(JSON.stringify({ok:false,error:"pdf extraction subprocess produced empty stdout"}))'; exit 0; fi`,
      `printf '%s' "${"$"}STDOUT_CONTENT"`,
    ].join("\n"),
  ]);

  return parsePdfExtractionSubprocessOutput(String(output || ""));
}

export function parsePdfExtractionSubprocessOutput(
  rawOutput: string,
): PDFPageText[] {
  const trimmed = String(rawOutput || "").trim();
  if (!trimmed) {
    throw new Error("PDF extraction subprocess returned no stdout.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `PDF extraction subprocess returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const result = parsed as {
    ok?: boolean;
    error?: unknown;
    pages?: Array<{
      pageIndex: number;
      pageLabel: string;
      spans: Array<{ text: string; rect: number[] }>;
    }>;
  };
  if (!result.ok) {
    throw new Error(
      `PDF extraction subprocess failed: ${
        typeof result.error === "string" && result.error.trim()
          ? result.error
          : "unknown subprocess error"
      }`,
    );
  }

  const pages = Array.isArray(result.pages) ? result.pages : [];
  return pages.map((page) => ({
    pageIndex: page.pageIndex,
    pageLabel: page.pageLabel,
    spans: page.spans
      .map((span) => ({
        pageIndex: page.pageIndex,
        pageLabel: page.pageLabel,
        ...span,
        normalizedText: normalizeQuoteText(span.text),
      }))
      .filter((span) => span.text.trim() && span.normalizedText),
  }));
}

export function shouldUsePdfSubprocessFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("No ScriptLoader found for the current context") ||
    message.includes('No "GlobalWorkerOptions.workerSrc" specified.')
  );
}

export async function extractPdfTextPagesWithFallback(
  filePath: string,
  options?: {
    extractInCurrentContext?: (filePath: string) => Promise<PDFPageText[]>;
    extractViaSubprocess?: (filePath: string) => Promise<PDFPageText[]>;
  },
) {
  const extractInCurrentContext =
    options?.extractInCurrentContext ?? extractPdfTextPagesInCurrentContext;
  const extractViaSubprocess =
    options?.extractViaSubprocess ?? extractPdfTextPagesViaSubprocess;

  try {
    return await extractInCurrentContext(filePath);
  } catch (error) {
    if (!shouldUsePdfSubprocessFallback(error)) {
      throw error;
    }
    return extractViaSubprocess(filePath);
  }
}

export async function extractPdfTextPages(
  filePath: string,
): Promise<PDFPageText[]> {
  return extractPdfTextPagesWithFallback(filePath);
}

export function buildSortIndex(pageIndex: number, rects: number[][]) {
  const [x1, y1] = rects[0] || [0, 0];
  const pagePart = Math.max(0, pageIndex).toString().padStart(5, "0");
  const topPart = Math.max(0, Math.round(y1 * 10))
    .toString()
    .padStart(6, "0");
  const leftPart = Math.max(0, Math.round(x1 * 10))
    .toString()
    .padStart(5, "0");
  return `${pagePart}|${topPart}|${leftPart}`;
}

export function mergeRectsOnSameLine(
  rects: number[][],
  tolerance = 2,
): number[][] {
  if (rects.length <= 1) {
    return rects;
  }

  const sorted = [...rects].sort((a, b) => {
    const yDiff = b[1] - a[1];
    if (Math.abs(yDiff) > tolerance) {
      return yDiff;
    }
    return a[0] - b[0];
  });

  const merged: number[][] = [];
  let current = [...sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    const sameLine =
      Math.abs(current[1] - next[1]) <= tolerance &&
      Math.abs(current[3] - next[3]) <= tolerance;
    const xClose = next[0] <= current[2] + 5;
    if (sameLine && xClose) {
      current[0] = Math.min(current[0], next[0]);
      current[2] = Math.max(current[2], next[2]);
      current[1] = Math.min(current[1], next[1]);
      current[3] = Math.max(current[3], next[3]);
    } else {
      merged.push(current);
      current = [...next];
    }
  }
  merged.push(current);

  return merged;
}

export function matchQuoteInPages(
  quote: string,
  pages: PDFPageText[],
): MatchedHighlight | undefined {
  const normalizedQuote = normalizeQuoteText(quote);
  if (!normalizedQuote) {
    return undefined;
  }

  for (const page of pages) {
    const indexed = buildPageIndex(page);
    const start = indexed.combined.indexOf(normalizedQuote);
    if (start < 0) {
      continue;
    }

    const end = start + normalizedQuote.length;

    const spanMatchRanges = new Map<
      number,
      { startInSpan: number; endInSpan: number }
    >();
    for (let cursor = start; cursor < end; cursor += 1) {
      const spanIndex = indexed.charToSpanIndex[cursor];
      if (typeof spanIndex !== "number" || spanIndex < 0) {
        continue;
      }
      const offsetInSpan = cursor - indexed.spanStartOffsets[spanIndex];
      const existing = spanMatchRanges.get(spanIndex);
      if (!existing) {
        spanMatchRanges.set(spanIndex, {
          startInSpan: offsetInSpan,
          endInSpan: offsetInSpan + 1,
        });
      } else {
        existing.endInSpan = Math.max(existing.endInSpan, offsetInSpan + 1);
      }
    }

    const rawRects: number[][] = [];
    for (const [spanIndex, range] of [...spanMatchRanges].sort(
      ([a], [b]) => a - b,
    )) {
      const span = page.spans[spanIndex];
      if (!span?.rect || span.rect.length !== 4) {
        continue;
      }
      const totalChars = span.normalizedText.length;
      if (totalChars <= 0) {
        continue;
      }

      const [x1, y1, x2, y2] = span.rect;
      const spanWidth = x2 - x1;

      if (spanWidth <= 0) {
        rawRects.push([x1, y1, x2, y2]);
        continue;
      }

      if (range.startInSpan === 0 && range.endInSpan >= totalChars) {
        rawRects.push([x1, y1, x2, y2]);
      } else {
        const n2oMap = buildNormalizedToOriginalMap(span.text);
        const origLen = span.text.normalize("NFKC").length;
        const origStart =
          range.startInSpan < n2oMap.length
            ? n2oMap[range.startInSpan]
            : n2oMap.length
              ? n2oMap[n2oMap.length - 1]
              : 0;
        const origEnd =
          range.endInSpan < n2oMap.length ? n2oMap[range.endInSpan] : origLen;
        const startFraction = origLen > 0 ? origStart / origLen : 0;
        const endFraction = origLen > 0 ? origEnd / origLen : 1;
        const newX1 = x1 + startFraction * spanWidth;
        const newX2 = x1 + endFraction * spanWidth;
        rawRects.push([newX1, y1, newX2, y2]);
      }
    }

    const rects = mergeRectsOnSameLine(rawRects);

    if (!rects.length) {
      continue;
    }

    return {
      quote,
      normalizedQuote,
      pageIndex: page.pageIndex,
      pageLabel: page.pageLabel,
      rects,
      sortIndex: buildSortIndex(page.pageIndex, rects),
    };
  }

  return undefined;
}
