import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  verifyChatCitations,
  openChatCitation,
  type ChatCitationDependencies,
} from "../src/modules/message/chatCitations";
import type { RequestContextSnapshot } from "../src/modules/context/requestContext";
import { normalizeQuoteText } from "../src/modules/autoHighlight/pdfMatch";

const snapshot: RequestContextSnapshot = {
  sourceID: "zotero:1:ITEM:PDF",
  source: {
    libraryID: 1,
    itemKey: "ITEM",
    attachmentKey: "PDF",
    standaloneAttachment: false,
  },
  itemID: 1,
  attachmentID: 2,
  paperTitle: "Paper",
  contentFingerprint: "fingerprint-v1",
  capturedAt: "2026-09-07",
  annotations: [],
  warnings: [],
};
const quote =
  "The proposed method improves retrieval through exact source grounding.";
function dependencies(): ChatCitationDependencies {
  return {
    assertCurrent: async () => {},
    resolveAttachment: async () => ({
      id: 2,
      libraryID: 1,
      key: "PDF",
      getFilePathAsync: async () => "/pdf",
    }),
    extractPages: async () => [
      {
        pageIndex: 0,
        pageLabel: "i",
        spans: [
          {
            pageIndex: 0,
            pageLabel: "i",
            text: quote,
            normalizedText: normalizeQuoteText(quote),
            rect: [0, 0, 40, 12],
          },
        ],
      },
    ],
  };
}
test("chat citations reuse exact local matching and reject invented pages or foreign sources", async () => {
  const verified = await verifyChatCitations(
    [
      { id: "a", sourceID: snapshot.sourceID, quote, pageIndex: 0 },
      { id: "b", sourceID: snapshot.sourceID, quote, pageIndex: 1 },
      { id: "c", sourceID: "zotero:2:ITEM:PDF", quote },
    ],
    snapshot,
    dependencies(),
  );
  assert.deepEqual(
    verified.map((citation) => citation.status),
    ["verified", "not-found"],
  );
  assert.equal(verified[0].reference?.pageLabel, "i");
  assert.equal(verified[0].sourceFingerprint, "fingerprint-v1");
});
test("source drift before or during local verification never yields a navigable citation", async () => {
  let checks = 0;
  const citations = await verifyChatCitations(
    [{ id: "a", sourceID: snapshot.sourceID, quote }],
    snapshot,
    {
      ...dependencies(),
      assertCurrent: async () => {
        if (++checks > 1) throw new Error("changed");
      },
    },
  );
  assert.equal(citations[0].status, "stale");
  assert.equal(citations[0].reference, undefined);
});
test("citation activation rechecks current source and opens only its exact library attachment", async () => {
  const deps = dependencies();
  const [citation] = await verifyChatCitations(
    [{ id: "a", sourceID: snapshot.sourceID, quote }],
    snapshot,
    deps,
  );
  const opened: number[] = [];
  await openChatCitation(citation, snapshot, {
    ...deps,
    navigation: {
      getByLibraryAndKey: (libraryID, key) => {
        assert.equal(libraryID, 1);
        assert.equal(key, "PDF");
        return { id: 2, libraryID: 1, key: "PDF" };
      },
      openReader: (id, options) => {
        opened.push(id);
        assert.equal(options.pageIndex, 0);
      },
    },
  });
  assert.deepEqual(opened, [2]);
  await assert.rejects(
    openChatCitation(citation, snapshot, {
      ...deps,
      assertCurrent: async () => {
        throw new Error("changed");
      },
    }),
    /cannot be verified/,
  );
  assert.deepEqual(opened, [2]);
});
