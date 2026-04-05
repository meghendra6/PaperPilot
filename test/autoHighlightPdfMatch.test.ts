import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildNormalizedToOriginalMap,
  buildSortIndex,
  extractPdfTextPages,
  extractPdfTextPagesFromPdfDocument,
  extractPdfTextPagesFromReader,
  extractPdfTextPagesWithFallback,
  matchQuoteInPages,
  mergeRectsOnSameLine,
  parsePdfExtractionSubprocessOutput,
  normalizeQuoteText,
  resolvePdfJsModuleSpecifier,
  shouldUsePdfSubprocessFallback,
} from "../src/modules/autoHighlight/pdfMatch";

test("normalizeQuoteText removes punctuation and whitespace", () => {
  assert.equal(normalizeQuoteText(' Z"otero — tool! '), "zoterotool");
});

test("extractPdfTextPages and matchQuoteInPages resolve a fixture quote", async () => {
  const pages = await extractPdfTextPages("test/fixtures/test.pdf");
  const match = matchQuoteInPages(
    "collect, organize, cite, and share your research sources.",
    pages,
  );

  assert.ok(match);
  assert.equal(match?.pageIndex, 0);
  assert.ok((match?.rects.length || 0) > 0);
  assert.match(match?.sortIndex || "", /^\d{5}\|\d{6}\|\d{5}$/);
});

test("extractPdfTextPagesFromPdfDocument extracts text spans from a reader-like pdfDocument", async () => {
  const pages = await extractPdfTextPagesFromPdfDocument({
    numPages: 1,
    getPage: async () => ({
      getTextContent: async () => ({
        items: [
          {
            str: "Alpha",
            transform: [10, 0, 0, 10, 5, 20],
            width: 20,
            height: 10,
          },
        ],
      }),
    }),
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].spans[0].text, "Alpha");
  assert.deepEqual(pages[0].spans[0].rect, [5, 20, 25, 30]);
});

test("extractPdfTextPagesFromReader supports pageView.pdfPage.getTextContent shape", async () => {
  const pages = await extractPdfTextPagesFromReader({
    _initPromise: Promise.resolve(),
    _internalReader: {
      _primaryView: {
        initializedPromise: Promise.resolve(),
        _iframeWindow: {
          PDFViewerApplication: {
            pagesCount: 1,
            pdfViewer: {
              getPageView: () => ({
                pdfPage: {
                  getTextContent: async () => ({
                    items: [
                      {
                        str: "Beta",
                        transform: [10, 0, 0, 10, 7, 30],
                        width: 20,
                        height: 10,
                      },
                    ],
                  }),
                },
              }),
            },
          },
        },
      },
    },
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].spans[0].text, "Beta");
  assert.deepEqual(pages[0].spans[0].rect, [7, 30, 27, 40]);
});

test("shouldUsePdfSubprocessFallback matches known runtime loader failures", () => {
  assert.equal(
    shouldUsePdfSubprocessFallback(
      new Error('No "GlobalWorkerOptions.workerSrc" specified.'),
    ),
    true,
  );
  assert.equal(
    shouldUsePdfSubprocessFallback(
      new Error("No ScriptLoader found for the current context"),
    ),
    true,
  );
});

test("extractPdfTextPagesWithFallback uses subprocess when workerSrc is missing", async () => {
  let subprocessCalled = false;
  const pages = await extractPdfTextPagesWithFallback("dummy.pdf", {
    extractInCurrentContext: async () => {
      throw new Error('No "GlobalWorkerOptions.workerSrc" specified.');
    },
    extractViaSubprocess: async () => {
      subprocessCalled = true;
      return [
        {
          pageIndex: 0,
          pageLabel: "1",
          spans: [
            {
              pageIndex: 0,
              pageLabel: "1",
              text: "Alpha",
              normalizedText: "alpha",
              rect: [1, 1, 2, 2],
            },
          ],
        },
      ];
    },
  });
  assert.equal(subprocessCalled, true);
  assert.equal(pages[0].spans[0].text, "Alpha");
});

test("resolvePdfJsModuleSpecifier prefers absolute file URL from addon root", async () => {
  const specifier = await resolvePdfJsModuleSpecifier({
    rootUri: "file:///Users/me/project/addon/",
    exists: async (path) =>
      path === "/Users/me/project/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  });
  assert.equal(
    specifier,
    "file:///Users/me/project/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  );
});

test("resolvePdfJsModuleSpecifier falls back to bare specifier when no file path is found", async () => {
  const specifier = await resolvePdfJsModuleSpecifier({
    rootUri: "chrome://paperpilot/content/",
    exists: async () => false,
  });
  assert.equal(specifier, "pdfjs-dist/legacy/build/pdf.mjs");
});

test("parsePdfExtractionSubprocessOutput reports empty stdout clearly", () => {
  assert.throws(
    () => parsePdfExtractionSubprocessOutput(""),
    /returned no stdout/i,
  );
});

test("parsePdfExtractionSubprocessOutput reports subprocess failure payloads clearly", () => {
  assert.throws(
    () =>
      parsePdfExtractionSubprocessOutput(
        JSON.stringify({ ok: false, error: "module not found" }),
      ),
    /subprocess failed: module not found/i,
  );
});

test("matchQuoteInPages matches across whitespace and punctuation normalization", () => {
  const match = matchQuoteInPages("Alpha beta", [
    {
      pageIndex: 0,
      pageLabel: "1",
      spans: [
        {
          pageIndex: 0,
          pageLabel: "1",
          text: "Alpha-",
          normalizedText: normalizeQuoteText("Alpha-"),
          rect: [0, 0, 10, 10],
        },
        {
          pageIndex: 0,
          pageLabel: "1",
          text: "beta",
          normalizedText: normalizeQuoteText("beta"),
          rect: [12, 0, 22, 10],
        },
      ],
    },
  ]);

  assert.ok(match);
  assert.deepEqual(match?.rects, [
    [0, 0, 22, 10],
  ]);
});

test("matchQuoteInPages chooses the earliest repeated quote deterministically", () => {
  const pages = [
    {
      pageIndex: 0,
      pageLabel: "1",
      spans: [
        {
          pageIndex: 0,
          pageLabel: "1",
          text: "Alpha",
          normalizedText: "alpha",
          rect: [1, 1, 2, 2],
        },
        {
          pageIndex: 0,
          pageLabel: "1",
          text: "Beta",
          normalizedText: "beta",
          rect: [3, 1, 4, 2],
        },
        {
          pageIndex: 0,
          pageLabel: "1",
          text: "Alpha",
          normalizedText: "alpha",
          rect: [5, 1, 6, 2],
        },
        {
          pageIndex: 0,
          pageLabel: "1",
          text: "Beta",
          normalizedText: "beta",
          rect: [7, 1, 8, 2],
        },
      ],
    },
  ];

  const match = matchQuoteInPages("Alpha Beta", pages);
  assert.deepEqual(match?.rects, [
    [1, 1, 4, 2],
  ]);
});

test("buildSortIndex is deterministic and changes with position", () => {
  assert.equal(buildSortIndex(0, [[10, 20, 30, 40]]), "00000|000200|00100");
  assert.notEqual(
    buildSortIndex(0, [[10, 20, 30, 40]]),
    buildSortIndex(1, [[10, 20, 30, 40]]),
  );
});

test("matchQuoteInPages calculates sub-span rects for partial span matches", () => {
  const pages = [{
    pageIndex: 0,
    pageLabel: "1",
    spans: [
      {
        pageIndex: 0,
        pageLabel: "1",
        text: "The novel approach works",
        normalizedText: normalizeQuoteText("The novel approach works"),
        rect: [0, 10, 100, 20],
      },
    ],
  }];

  const match = matchQuoteInPages("novel approach", pages);
  assert.ok(match);
  assert.equal(match?.rects.length, 1);
  const rect = match!.rects[0];
  assert.ok(rect[0] > 0, "left edge should not start at span beginning");
  assert.ok(rect[2] < 100, "right edge should not extend to span end");
});

test("matchQuoteInPages merges adjacent rects on the same line", () => {
  const pages = [{
    pageIndex: 0,
    pageLabel: "1",
    spans: [
      { pageIndex: 0, pageLabel: "1", text: "One", normalizedText: "one", rect: [0, 50, 20, 60] },
      { pageIndex: 0, pageLabel: "1", text: "Two", normalizedText: "two", rect: [22, 50, 42, 60] },
      { pageIndex: 0, pageLabel: "1", text: "Three", normalizedText: "three", rect: [44, 50, 70, 60] },
    ],
  }];

  const match = matchQuoteInPages("One Two Three", pages);
  assert.ok(match);
  assert.equal(match?.rects.length, 1, "same-line rects should merge into one");
  assert.deepEqual(match?.rects, [[0, 50, 70, 60]]);
});

test("matchQuoteInPages keeps separate rects for different lines", () => {
  const pages = [{
    pageIndex: 0,
    pageLabel: "1",
    spans: [
      { pageIndex: 0, pageLabel: "1", text: "End of line one", normalizedText: normalizeQuoteText("End of line one"), rect: [50, 200, 300, 210] },
      { pageIndex: 0, pageLabel: "1", text: "Start of line two", normalizedText: normalizeQuoteText("Start of line two"), rect: [10, 180, 250, 190] },
    ],
  }];

  const match = matchQuoteInPages("End of line one Start of line two", pages);
  assert.ok(match);
  assert.equal(match?.rects.length, 2, "rects on different lines should remain separate");
});

test("mergeRectsOnSameLine merges overlapping rects on same y-line", () => {
  const rects = [
    [0, 50, 30, 60],
    [25, 50, 60, 60],
    [55, 50, 80, 60],
  ];
  const merged = mergeRectsOnSameLine(rects);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged, [[0, 50, 80, 60]]);
});

test("mergeRectsOnSameLine preserves rects on different lines", () => {
  const rects = [
    [0, 50, 100, 60],
    [0, 30, 100, 40],
  ];
  const merged = mergeRectsOnSameLine(rects);
  assert.equal(merged.length, 2);
});

test("mergeRectsOnSameLine does not merge same-line rects with large x-gap", () => {
  const rects = [
    [0, 50, 100, 60],
    [300, 50, 400, 60],
  ];
  const merged = mergeRectsOnSameLine(rects);
  assert.equal(merged.length, 2, "rects far apart on same line should stay separate");
});

test("matchQuoteInPages uses original text length for sub-span fraction", () => {
  const pages = [{
    pageIndex: 0,
    pageLabel: "1",
    spans: [
      {
        pageIndex: 0,
        pageLabel: "1",
        text: "Hello, world! Amazing",
        normalizedText: normalizeQuoteText("Hello, world! Amazing"),
        rect: [0, 10, 210, 20],
      },
    ],
  }];

  const match = matchQuoteInPages("amazing", pages);
  assert.ok(match);
  const rect = match!.rects[0];
  // "Amazing" starts at original char index 14 out of 21 (NFKC) chars
  // fraction ≈ 14/21 ≈ 0.667 → x ≈ 140
  assert.ok(rect[0] >= 135 && rect[0] <= 145, `left edge ${rect[0]} should be near 140`);
});

test("matchQuoteInPages handles bracket-containing text correctly", () => {
  const pages = [{
    pageIndex: 0,
    pageLabel: "1",
    spans: [
      {
        pageIndex: 0,
        pageLabel: "1",
        text: "the [1] result is strong",
        normalizedText: normalizeQuoteText("the [1] result is strong"),
        rect: [0, 10, 240, 20],
      },
    ],
  }];

  const match = matchQuoteInPages("result is strong", pages);
  assert.ok(match);
  const rect = match!.rects[0];
  // "result" starts at NFKC index 8 out of 24 chars → fraction ≈ 0.333 → x ≈ 80
  assert.ok(rect[0] > 50, `left edge ${rect[0]} should start after bracket region`);
  assert.ok(rect[2] <= 240, `right edge ${rect[2]} should not exceed span width`);
});

// --- buildNormalizedToOriginalMap direct tests ---

test("buildNormalizedToOriginalMap length matches normalizeQuoteText length (no brackets)", () => {
  const input = "Hello World 123";
  const map = buildNormalizedToOriginalMap(input);
  const normalized = normalizeQuoteText(input);
  assert.equal(map.length, normalized.length, `map length ${map.length} !== normalized length ${normalized.length} for "${input}"`);
});

test("buildNormalizedToOriginalMap length matches normalizeQuoteText length (matched brackets)", () => {
  const input = "the [1] result";
  const map = buildNormalizedToOriginalMap(input);
  const normalized = normalizeQuoteText(input);
  assert.equal(map.length, normalized.length, `map length ${map.length} !== normalized length ${normalized.length} for "${input}"`);
});

test("buildNormalizedToOriginalMap length matches normalizeQuoteText length (unmatched open bracket)", () => {
  const input = "the result [1";
  const map = buildNormalizedToOriginalMap(input);
  const normalized = normalizeQuoteText(input);
  assert.equal(map.length, normalized.length, `map length ${map.length} !== normalized length ${normalized.length} for "${input}"`);
});

test("buildNormalizedToOriginalMap length matches normalizeQuoteText length (nested brackets)", () => {
  const input = "a[[b]]c";
  const map = buildNormalizedToOriginalMap(input);
  const normalized = normalizeQuoteText(input);
  assert.equal(map.length, normalized.length, `map length ${map.length} !== normalized length ${normalized.length} for "${input}"`);
});

test("buildNormalizedToOriginalMap length matches normalizeQuoteText length (empty brackets)", () => {
  const input = "before[]after";
  const map = buildNormalizedToOriginalMap(input);
  const normalized = normalizeQuoteText(input);
  assert.equal(map.length, normalized.length, `map length ${map.length} !== normalized length ${normalized.length} for "${input}"`);
});

test("buildNormalizedToOriginalMap returns empty for empty string", () => {
  assert.deepEqual(buildNormalizedToOriginalMap(""), []);
});

test("buildNormalizedToOriginalMap maps indices correctly for simple text", () => {
  // "ab" after NFKC + strip brackets + alphanumeric filter → "ab" at indices 0 and 1
  const map = buildNormalizedToOriginalMap("ab");
  assert.deepEqual(map, [0, 1]);
});

test("buildNormalizedToOriginalMap maps indices correctly with brackets", () => {
  // "a[1]b" → strip "[1]" → "a" at 0, "b" at 4
  const map = buildNormalizedToOriginalMap("a[1]b");
  assert.deepEqual(map, [0, 4]);
});
