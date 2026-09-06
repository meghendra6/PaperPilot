import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as capabilities from "../src/modules/discovery/capabilities";
import * as workspaceRun from "../src/modules/ai/workspaceRun";
import {
  captureRequestContext,
  readRequestPaperContent,
  type RequestContextSnapshot,
} from "../src/modules/context/requestContext";
import {
  generateRelatedPaperGroups,
  generatePublicReviewInsight,
} from "../src/modules/relatedRecommendations";
import { sessionStore } from "../src/modules/session/sessionStore";

const runTypes = ["discovery", "public-review"] as const;

for (const runType of runTypes) {
  test(`${runType} forwards the captured second PDF and preserves actionable source failures`, async (t) => {
    const runtime = globalThis as any;
    const previous = { Zotero: runtime.Zotero, addon: runtime.addon };
    const itemID = runType === "discovery" ? 7101 : 7102;
    const parent = {
      id: itemID,
      key: `PAPER_${itemID}`,
      libraryID: 1,
      isAttachment: () => false,
      getAttachments: () => [itemID + 10, itemID + 20],
      getField: () => "Paper with two PDFs",
      getCreators: () => [],
    };
    const pdf = (offset: number, key: string) => ({
      id: itemID + offset,
      key: `${key}_${itemID}`,
      libraryID: 1,
      parentItemID: itemID,
      version: 1,
      isAttachment: () => true,
      attachmentContentType: "application/pdf",
      getFilePathAsync: async () => `/test/${key}_${itemID}.pdf`,
      attachmentText: `${key} source text`,
    });
    const a = pdf(10, "PDF_A");
    const b = pdf(20, "PDF_B");
    const items = new Map([
      [parent.id, parent],
      [a.id, a],
      [b.id, b],
    ] as Array<[number, any]>);
    runtime.Zotero = {
      Items: {
        getAsync: async (id: number) => items.get(id),
        get: (id: number) => items.get(id),
      },
      Prefs: { get: () => false },
    };
    runtime.addon = {
      data: { modeOverrides: new Map([[itemID, "codex_cli"]]) },
    };
    t.mock.method(capabilities, "getDiscoveryCapabilities", () => ({
      agentWebSearch: true,
      officialEvidenceFetch: true,
      structuredCandidateSearch: false,
    }));
    let expectedContext: RequestContextSnapshot | undefined;
    let started = 0;
    const launchBoundary = new Error(
      "private-startup-marker /private/user/cli",
    );
    t.mock.method(
      workspaceRun,
      "startWorkspaceTextRun",
      async (
        params: Parameters<typeof workspaceRun.startWorkspaceTextRun>[0],
      ) => {
        started += 1;
        assert.equal(params.requestContext, expectedContext);
        assert.ok(params.requestContext);
        assert.equal(params.requestContext?.attachmentID, b.id);
        const content = await readRequestPaperContent(params.requestContext);
        assert.equal(content.content.fullText, "PDF_B source text");
        throw launchBoundary;
      },
    );
    const run = (
      requestContext?: RequestContextSnapshot,
      onStatus?: (status: string) => void,
    ) => {
      const params = {
        itemID,
        itemTitle: "Paper with two PDFs",
        requestContext,
        onStatus,
      };
      return runType === "discovery"
        ? generateRelatedPaperGroups(params)
        : generatePublicReviewInsight({
            ...params,
            paper: {
              title: "Reviewed paper",
              authors: [],
              reviewURL: "https://openreview.net/forum?id=fixture",
            },
          });
    };
    try {
      const reader = { _item: { id: b.id } };
      expectedContext = await captureRequestContext({ itemID, reader });
      reader._item.id = a.id; // A later active reader cannot replace PDF B.
      await assert.rejects(run(expectedContext), (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /could not start/);
        assert.doesNotMatch(error.message, /private-startup-marker/);
        return true;
      });
      assert.equal(started, 1);
      await assert.rejects(run(), /Choose the exact PDF/);
      assert.equal(
        started,
        1,
        "ambiguous source cannot reach the launch boundary",
      );
      await assert.rejects(
        run(expectedContext, () => {
          b.version = 2;
        }),
        /changed/,
      );
      assert.equal(started, 1, "source drift cannot reach the launch boundary");
      assert.equal(workspaceRun.isWorkspaceRunReservedForItem(itemID), false);
    } finally {
      sessionStore.reset(itemID);
      runtime.Zotero = previous.Zotero;
      runtime.addon = previous.addon;
    }
  });
}
