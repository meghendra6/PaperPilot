import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildHighlightAnnotationJSON,
  isDuplicateHighlight,
} from "../src/modules/autoHighlight/annotation";

(globalThis as typeof globalThis & { Zotero?: unknown }).Zotero = {
  DataObjectUtilities: {
    generateKey: () => "AUTO1234",
  },
};

test("buildHighlightAnnotationJSON creates Zotero-compatible highlight payload", () => {
  const payload = buildHighlightAnnotationJSON({
    quote: "Exact quote",
    normalizedQuote: "exactquote",
    pageIndex: 0,
    pageLabel: "1",
    rects: [[1, 2, 3, 4]],
    sortIndex: "00000|000020|00010",
  });

  assert.deepEqual(payload, {
    key: "AUTO1234",
    type: "highlight",
    text: "Exact quote",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|000020|00010",
    position: {
      pageIndex: 0,
      rects: [[1, 2, 3, 4]],
    },
  });
});

test("isDuplicateHighlight matches same normalized quote on same page only", () => {
  const duplicate = isDuplicateHighlight(
    {
      isAnnotation: () => true,
      annotationType: "highlight",
      annotationText: "Exact quote!",
      annotationPosition: JSON.stringify({
        pageIndex: 0,
        rects: [[0, 0, 1, 1]],
      }),
    } as any,
    {
      quote: "Exact quote",
      normalizedQuote: "exactquote",
      pageIndex: 0,
      pageLabel: "1",
      rects: [[1, 2, 3, 4]],
      sortIndex: "00000|000020|00010",
    },
  );
  const differentPage = isDuplicateHighlight(
    {
      isAnnotation: () => true,
      annotationType: "highlight",
      annotationText: "Exact quote!",
      annotationPosition: JSON.stringify({
        pageIndex: 1,
        rects: [[0, 0, 1, 1]],
      }),
    } as any,
    {
      quote: "Exact quote",
      normalizedQuote: "exactquote",
      pageIndex: 0,
      pageLabel: "1",
      rects: [[1, 2, 3, 4]],
      sortIndex: "00000|000020|00010",
    },
  );

  assert.equal(duplicate, true);
  assert.equal(differentPage, false);
});
