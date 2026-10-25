import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as capabilities from "../src/modules/discovery/capabilities";
import * as workspace from "../src/modules/ai/workspaceRun";
import * as runFiles from "../src/modules/ai/runFileReader";
import * as processControl from "../src/modules/ai/runCompletion";
import * as cleanup from "../src/modules/workspace/cleanup";
import * as context from "../src/modules/context/requestContext";
import {
  generateRelatedPaperGroups,
  generatePublicReviewInsight,
} from "../src/modules/relatedRecommendations";
import { sessionStore } from "../src/modules/session/sessionStore";

for (const workflow of ["discovery", "public-review"] as const) {
  for (const stopFails of [false, true]) {
    test(`${workflow} retains process ownership after an unreadable exit marker (stop fails: ${stopFails})`, async (t) => {
      const runtime = globalThis as any;
      const previous = { addon: runtime.addon, Zotero: runtime.Zotero };
      const itemID = 8101;
      const item = { getField: () => "Paper", getCreators: () => [] };
      runtime.addon = {
        data: { modeOverrides: new Map([[itemID, "codex_cli"]]) },
      };
      runtime.Zotero = {
        Prefs: { get: () => false },
        Items: { getAsync: async () => item },
      };
      t.after(() => {
        sessionStore.reset(itemID);
        runtime.addon = previous.addon;
        runtime.Zotero = previous.Zotero;
      });
      t.mock.method(capabilities, "getDiscoveryCapabilities", () => ({
        agentWebSearch: true,
        officialEvidenceFetch: true,
        structuredCandidateSearch: false,
      }));
      t.mock.method(
        context,
        "assertRequestContextCurrent",
        async () => undefined,
      );
      t.mock.method(workspace, "startWorkspaceTextRun", async () => ({
        ok: true as const,
        workspacePath: "/owned/discovery",
        promptPreview: "",
        outputPath: "/out",
        stderrPath: "/err",
        exitCodePath: "/exit",
        pidPath: "/pid",
        processId: "12345",
      }));
      // Exercise the real Codex and shared progress readers' synthetic marker.
      t.mock.method(
        runFiles,
        "readOptionalRunTextFile",
        async (path: string) => (path === "/exit" ? undefined : ""),
      );
      const events: string[] = [];
      t.mock.method(processControl, "stopDetachedRunProcess", async () => {
        events.push("stop");
        if (stopFails) throw new Error("termination unconfirmed");
      });
      t.mock.method(cleanup, "cleanupWorkspaceIfEnabled", async () => {
        events.push("cleanup");
        return true;
      });
      const params = {
        itemID,
        itemTitle: "Paper",
        requestContext: {} as context.RequestContextSnapshot,
      };
      const run =
        workflow === "discovery"
          ? generateRelatedPaperGroups(params)
          : generatePublicReviewInsight({
              ...params,
              paper: {
                title: "Reviewed paper",
                authors: [],
                reviewURL: "https://openreview.net/forum?id=fixture",
              },
            });
      await assert.rejects(run, stopFails ? /could not be stopped/ : /failed/i);
      assert.deepEqual(events, stopFails ? ["stop"] : ["stop", "cleanup"]);
      assert.equal(workspace.isWorkspaceRunReservedForItem(itemID), stopFails);
    });
  }
}
