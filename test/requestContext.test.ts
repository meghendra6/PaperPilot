import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  captureRequestContext,
  readRequestPaperContent,
  assertRequestContextCurrent,
  prepareRunInput,
} from "../src/modules/context/requestContext";

function install() {
  const runtime = globalThis as any;
  const old = runtime.Zotero;
  const annotation = {
    id: 31,
    key: "NOTE_B",
    parentItemID: 22,
    annotationText: "PDF B selected quote",
    annotationComment: "My concern",
    annotationType: "highlight",
    annotationPageLabel: "iv",
    annotationPosition: JSON.stringify({ pageIndex: 3, rects: [[1, 2, 3, 4]] }),
  };
  const parent = {
    id: 1,
    key: "PAPER",
    libraryID: 1,
    isAttachment: () => false,
    getAttachments: () => [21, 22],
    getField: () => "Actual paper title",
    getCreators: () => [],
  };
  const pdf = (id: number, key: string, text: string) => ({
    id,
    key,
    libraryID: 1,
    parentItemID: 1,
    version: 1,
    isAttachment: () => true,
    attachmentContentType: "application/pdf",
    getFilePathAsync: async () => `/test/${key}.pdf`,
    attachmentText: text,
    getAnnotations: () => (id === 22 ? [annotation] : []),
  });
  const a = pdf(21, "PDF_A", "PDF A text");
  const b = pdf(22, "PDF_B", "PDF B text");
  const items = new Map<number, any>([
    [1, parent],
    [21, a],
    [22, b],
  ]);
  runtime.Zotero = {
    Items: {
      getAsync: async (id: number) => items.get(id),
      get: (id: number) => items.get(id),
    },
    Prefs: { get: () => false },
  };
  return {
    a,
    b,
    annotation,
    restore: () => {
      runtime.Zotero = old;
    },
  };
}

test("request snapshot binds explicit PDF B and real annotations, never parent PDF A", async () => {
  const env = install();
  try {
    const context = await captureRequestContext({
      itemID: 1,
      attachmentID: 22,
      annotationIDs: ["NOTE_B"],
      pageIndex: 3,
      pageLabel: "iv",
    });
    assert.equal(context.sourceID, "zotero:1:PAPER:PDF_B");
    assert.equal(context.paperTitle, "Actual paper title");
    assert.equal(context.annotations[0].quote, "PDF B selected quote");
    assert.equal(context.annotations[0].comment, "My concern");
    assert.equal(context.pageIndex, 3);
    assert.equal(context.pageLabel, "iv");
    const result = await readRequestPaperContent(context);
    assert.equal(result.content.fullText, "PDF B text");
    env.b.version = 2;
    await assert.rejects(() => assertRequestContextCurrent(context), /changed/);
  } finally {
    env.restore();
  }
});

test("ambiguous parent, wrong paper and unavailable annotations fail before model input", async () => {
  const env = install();
  try {
    await assert.rejects(
      () => captureRequestContext({ itemID: 1, attachmentID: 999 }),
      /explicitly selected PDF/,
    );
    await assert.rejects(
      () => captureRequestContext({ itemID: 1 }),
      /exact PDF/,
    );
    await assert.rejects(
      () =>
        captureRequestContext({
          itemID: 1,
          attachmentID: 22,
          annotationIDs: ["MISSING"],
        }),
      /could not be read/,
    );
    env.b.parentItemID = 9;
    await assert.rejects(
      () => captureRequestContext({ itemID: 1, attachmentID: 22 }),
      /does not belong/,
    );
  } finally {
    env.restore();
  }
});

test("prebuilt project input cannot consult or inject a parent paper", async () => {
  const runtime = globalThis as any;
  const old = runtime.Zotero;
  runtime.Zotero = {
    Items: {
      getAsync: () => {
        throw new Error("Unexpected parent read");
      },
    },
  };
  try {
    const result = await prepareRunInput({
      itemID: 1,
      sessionId: "project",
      question: "Compare",
      settings: {
        mode: "claude_code",
        model: "sonnet",
        responseLanguage: "English",
      },
      timings: { preparingAt: 1 },
      prebuiltInput: {
        files: { "PROJECT_INDEX.md": "Read B", "papers/B.md": "PDF B only" },
        sourceIDs: ["B"],
        scopeFingerprint: "scope-b",
      },
    });
    assert.equal(
      (result.files as Record<string, string>)["papers/B.md"],
      "PDF B only",
    );
    assert.equal(
      (result.files as Record<string, string>)["paper.md"],
      undefined,
    );
    assert.deepEqual(result.sourceIDs, ["B"]);
    assert.match(result.files["CONTEXT_INDEX.md"], /papers\/B.md/);
  } finally {
    runtime.Zotero = old;
  }
});

test("snapshot ignores a different live reader and freezes selection before source awaits", async () => {
  const env = install();
  try {
    const annotation = {
      text: "submitted quote",
      position: { pageIndex: 2 },
      pageLabel: "iii",
    };
    const reader = {
      _item: { id: 21 },
      _internalReader: { _lastView: { _selectionPopup: { annotation } } },
    };
    const mismatched = await captureRequestContext({
      itemID: 1,
      attachmentID: 22,
      reader,
    });
    assert.equal(mismatched.selectedText, undefined);
    assert.equal(mismatched.pageIndex, undefined);
    reader._item.id = 22;
    const pending = captureRequestContext({
      itemID: 1,
      attachmentID: 22,
      reader,
    });
    annotation.text = "later quote";
    annotation.position.pageIndex = 8;
    const captured = await pending;
    assert.equal(captured.selectedText, "submitted quote");
    assert.equal(captured.pageIndex, 2);
  } finally {
    env.restore();
  }
});

test("removed PDF fails source revalidation even when metadata fingerprint is unchanged", async () => {
  const env = install();
  const runtime = globalThis as any;
  const oldIO = runtime.IOUtils;
  try {
    runtime.IOUtils = { exists: async () => true };
    const context = await captureRequestContext({
      itemID: 1,
      attachmentID: 22,
    });
    runtime.IOUtils.exists = async () => false;
    await assert.rejects(
      () => assertRequestContextCurrent(context),
      /file is unavailable/,
    );
    await assert.rejects(
      () => captureRequestContext({ itemID: 1, attachmentID: 22 }),
      /file is unavailable/,
    );
  } finally {
    runtime.IOUtils = oldIO;
    env.restore();
  }
});
