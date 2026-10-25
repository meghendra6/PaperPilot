import { test } from "node:test";
import * as assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";

import { parseHighlightCandidatesWithRepair } from "../src/modules/autoHighlight/response";
import { formatAutoHighlightCancelledStatus } from "../src/modules/autoHighlight/status";
import {
  AutoHighlightCancelledError,
  rollBackCancelledHighlights,
  runAutoHighlightWorkflow,
} from "../src/modules/autoHighlight/workflow";
import * as workspaceRun from "../src/modules/ai/workspaceRun";
import * as runCompletion from "../src/modules/ai/runCompletion";
import * as cleanup from "../src/modules/workspace/cleanup";
import * as pdfMatch from "../src/modules/autoHighlight/pdfMatch";

test("parseHighlightCandidatesWithRepair repairs prose-only responses via retry", async () => {
  const seenStatuses: string[] = [];
  let requestCount = 0;

  const repaired = await parseHighlightCandidatesWithRepair({
    itemID: 1,
    title: "Paper",
    rawResponse: "Here are the key passages:\n1. First one\n2. Second one",
    onStatus: (status) => seenStatuses.push(status),
    requestText: async () => {
      requestCount += 1;
      return JSON.stringify({
        highlights: [{ quote: "Exact repaired quote", reason: "ignored" }],
      });
    },
  });

  assert.equal(requestCount, 1);
  assert.deepEqual(seenStatuses, ["Repairing AI response…"]);
  assert.deepEqual(repaired, [{ quote: "Exact repaired quote" }]);
});

for (const terminationFails of [false, true]) {
  test(
    `auto-highlight cancellation keeps the paper reserved until late preparation cleanup ${terminationFails ? "fails" : "succeeds"}`,
    { timeout: 2_000 },
    async (t) => {
      const runtime = globalThis as any;
      const previous = {
        addon: runtime.addon,
        Zotero: runtime.Zotero,
        ztoolkit: runtime.ztoolkit,
      };
      const itemID = 601;
      runtime.addon = {
        data: { modeOverrides: new Map([[itemID, "codex_cli"]]) },
      };
      runtime.Zotero = {
        Items: {
          getAsync: async () => ({
            id: itemID,
            isPDFAttachment: () => true,
          }),
        },
      };
      runtime.ztoolkit = {
        Reader: { getReader: async () => ({ itemID }) },
      };
      let finishPreparation: (
        value: workspaceRun.WorkspaceRunResult,
      ) => void = () => assert.fail("preparation was not initialized");
      const preparation = new Promise<workspaceRun.WorkspaceRunResult>(
        (resolve) => {
          finishPreparation = resolve;
        },
      );
      let enteredPreparation = () => {};
      const preparing = new Promise<void>((resolve) => {
        enteredPreparation = resolve;
      });
      const realStart = workspaceRun.startWorkspaceTextRun;
      t.mock.method(
        workspaceRun,
        "startWorkspaceTextRun",
        (params: Parameters<typeof realStart>[0]) =>
          realStart({
            ...params,
            prepareRun: () => {
              enteredPreparation();
              return preparation;
            },
          }),
      );
      let stopCount = 0;
      t.mock.method(runCompletion, "stopDetachedRunProcess", async () => {
        stopCount += 1;
        if (terminationFails) throw new Error("termination unconfirmed");
      });
      t.mock.method(cleanup, "cleanupWorkspaceIfEnabled", async () => false);
      const statuses: string[] = [];
      const controller = new AbortController();
      const lateRun: workspaceRun.WorkspaceRunResult = {
        ok: true,
        processId: "424242",
        workspacePath: "/tmp/601-test",
        promptPreview: "",
        outputPath: "out",
        stderrPath: "err",
        exitCodePath: "exit",
        pidPath: "pid",
      };
      try {
        const run = runAutoHighlightWorkflow({
          itemID,
          itemTitle: "Paper",
          signal: controller.signal,
          deadline: Date.now() + 60_000,
          onStatus: (status) => statuses.push(status),
        });
        const cancelled = assert.rejects(run, /highlighting cancelled/);
        await preparing;
        controller.abort();
        await cancelled;
        assert.equal(workspaceRun.isWorkspaceRunReservedForItem(itemID), true);
        assert.equal(
          workspaceRun.claimWorkspaceRunReservation("codex_cli", itemID),
          undefined,
        );
        finishPreparation(lateRun);
        await setImmediate();
        assert.equal(stopCount, 1);
        assert.equal(
          workspaceRun.isWorkspaceRunReservedForItem(itemID),
          terminationFails,
        );
        if (terminationFails) {
          assert.match(statuses.at(-1) ?? "", /remains reserved/);
        }
      } finally {
        finishPreparation(lateRun);
        await setImmediate();
        Object.assign(runtime, previous);
      }
    },
  );
}

test("auto-highlight respects an expired deadline before starting preparation", async (t) => {
  const runtime = globalThis as any;
  const previous = {
    addon: runtime.addon,
    Zotero: runtime.Zotero,
    ztoolkit: runtime.ztoolkit,
  };
  const itemID = 602;
  runtime.addon = {
    data: { modeOverrides: new Map([[itemID, "codex_cli"]]) },
  };
  runtime.Zotero = {
    Items: {
      getAsync: async () => ({ id: itemID, isPDFAttachment: () => true }),
    },
  };
  runtime.ztoolkit = { Reader: { getReader: async () => ({ itemID }) } };
  const realStart = workspaceRun.startWorkspaceTextRun;
  t.mock.method(
    workspaceRun,
    "startWorkspaceTextRun",
    (params: Parameters<typeof realStart>[0]) =>
      realStart({
        ...params,
        prepareRun: async () => assert.fail("expired work must not start"),
      }),
  );
  try {
    await assert.rejects(
      runAutoHighlightWorkflow({
        itemID,
        itemTitle: "Paper",
        deadline: Date.now() - 1,
      }),
      /highlighting timed out/,
    );
    assert.equal(workspaceRun.isWorkspaceRunReservedForItem(itemID), false);
  } finally {
    Object.assign(runtime, previous);
  }
});

for (const stopFails of [false, true]) {
  test(`auto-highlight confirms process termination after an unreadable exit marker (stop fails: ${stopFails})`, async (t) => {
    const runtime = globalThis as any;
    const previous = {
      addon: runtime.addon,
      Zotero: runtime.Zotero,
      ztoolkit: runtime.ztoolkit,
    };
    const itemID = 603;
    runtime.addon = {
      data: { modeOverrides: new Map([[itemID, "codex_cli"]]) },
    };
    runtime.Zotero = {
      Items: {
        getAsync: async () => ({ id: itemID, isPDFAttachment: () => true }),
      },
    };
    runtime.ztoolkit = { Reader: { getReader: async () => ({ itemID }) } };
    t.mock.method(workspaceRun, "startWorkspaceTextRun", async () => ({
      ok: true,
      workspacePath: "/owned",
      outputPath: "out",
      stderrPath: "err",
      exitCodePath: "exit",
      pidPath: "pid",
      promptPreview: "",
      processId: "424242",
    }));
    t.mock.method(workspaceRun, "readWorkspaceRunProgress", async () => ({
      completed: true,
      exitCode: "file-read-error",
      processExitCode: "file-read-error",
      rawOutput: "",
      diagnosticOutput: "exit marker unreadable",
      parsedOutput: "",
    }));
    let stopped = false;
    let cleaned = false;
    t.mock.method(runCompletion, "stopDetachedRunProcess", async () => {
      assert.equal(workspaceRun.isWorkspaceRunReservedForItem(itemID), true);
      assert.equal(cleaned, false);
      stopped = true;
      if (stopFails) throw new Error("termination unconfirmed");
    });
    t.mock.method(cleanup, "cleanupWorkspaceIfEnabled", async () => {
      assert.equal(stopped, true);
      cleaned = true;
      return false;
    });
    try {
      await assert.rejects(
        runAutoHighlightWorkflow({ itemID, itemTitle: "Paper" }),
        stopFails ? /could not be stopped/ : /highlight run failed/,
      );
      assert.equal(stopped, true);
      assert.equal(cleaned, !stopFails);
      assert.equal(
        workspaceRun.isWorkspaceRunReservedForItem(itemID),
        stopFails,
      );
    } finally {
      Object.assign(runtime, previous);
    }
  });
}

for (const scenario of [
  { name: "exact PDF", requestedID: 711, readerID: 721, expectedID: 711 },
  { name: "parent fallback", requestedID: 710, readerID: 721, expectedID: 711 },
  {
    name: "parent's open second PDF",
    requestedID: 710,
    readerID: 712,
    expectedID: 712,
  },
]) {
  test(`auto-highlight binds ${scenario.name} to the requested paper`, async (t) => {
    const runtime = globalThis as any;
    const previous = {
      addon: runtime.addon,
      Zotero: runtime.Zotero,
      ztoolkit: runtime.ztoolkit,
    };
    const pdf = (id: number, parentItemID: number) => ({
      id,
      parentItemID,
      libraryID: 1,
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    const parent = {
      id: 710,
      libraryID: 1,
      isAttachment: () => false,
      isPDFAttachment: () => false,
      getAttachments: () => [711, 712],
    };
    const items = new Map<number, any>([
      [710, parent],
      [711, pdf(711, 710)],
      [712, pdf(712, 710)],
      [721, pdf(721, 720)],
    ]);
    runtime.addon = {
      data: {
        modeOverrides: new Map([[scenario.requestedID, "codex_cli"]]),
      },
    };
    runtime.Zotero = {
      Items: {
        getAsync: async (id: number) => items.get(id),
        get: (id: number) => items.get(id),
      },
    };
    runtime.ztoolkit = {
      Reader: { getReader: async () => ({ itemID: scenario.readerID }) },
    };
    const analyzedAttachments: number[] = [];
    t.mock.method(
      workspaceRun,
      "startWorkspaceTextRun",
      async (
        params: Parameters<typeof workspaceRun.startWorkspaceTextRun>[0],
      ) => {
        analyzedAttachments.push(params.itemID);
        assert.equal(params.reservationItemID, scenario.requestedID);
        throw new Error("stop at the provider boundary");
      },
    );
    try {
      await assert.rejects(
        runAutoHighlightWorkflow({
          itemID: scenario.requestedID,
          itemTitle: "Requested paper A",
        }),
        /highlight run could not start/,
      );
      assert.deepEqual(analyzedAttachments, [scenario.expectedID]);
      assert.equal(
        workspaceRun.isWorkspaceRunReservedForItem(scenario.requestedID),
        false,
      );
    } finally {
      Object.assign(runtime, previous);
    }
  });
}

test("a cancelled run erases the highlights it already saved", async () => {
  const erased: number[] = [];
  const saved = [1, 2, 3].map((id) => ({
    eraseTx: async () => {
      if (id === 3) throw new Error("locked");
      erased.push(id);
      return true;
    },
  }));

  const error = await rollBackCancelledHighlights(saved);
  assert.deepEqual(erased, [1, 2]);
  assert.ok(error instanceof AutoHighlightCancelledError);
  assert.equal(error.keptHighlights, 1);
  assert.match(error.message, /highlighting cancelled\. 1 highlight could not/);
  assert.equal(
    formatAutoHighlightCancelledStatus(error.keptHighlights),
    "Highlighting cancelled. 1 highlight could not be removed.",
  );
  assert.equal(formatAutoHighlightCancelledStatus(0), "Highlighting cancelled");

  const clean = await rollBackCancelledHighlights([]);
  assert.equal(clean.keptHighlights, 0);
  assert.equal(clean.message, "Automatic highlighting cancelled.");
});

for (const scenario of [
  "save-resolves",
  "save-rejects",
  "refresh-resolves",
  "refresh-rejects",
] as const) {
  test(`cancelling auto-highlight rolls back owned annotations when ${scenario}`, async (t) => {
    const runtime = globalThis as any;
    const previous = {
      addon: runtime.addon,
      Zotero: runtime.Zotero,
      ztoolkit: runtime.ztoolkit,
    };
    const itemID = 713;
    const controller = new AbortController();
    const savedIDs: number[] = [];
    const erasedIDs: number[] = [];
    let saveCount = 0;
    const attachment = {
      id: itemID,
      isPDFAttachment: () => true,
      getFilePathAsync: async () => "/paper.pdf",
      getAnnotations: () => [],
    };
    runtime.addon = {
      data: { modeOverrides: new Map([[itemID, "codex_cli"]]) },
    };
    runtime.Zotero = {
      Items: { getAsync: async () => attachment },
      DataObjectUtilities: { generateKey: () => "NEWKEY" },
      Annotations: {
        saveFromJSON: async () => {
          const id = ++saveCount;
          if (id === 2 && scenario.startsWith("save-")) {
            controller.abort();
            if (scenario === "save-rejects")
              throw new Error("write failed after cancel");
          }
          savedIDs.push(id);
          return {
            eraseTx: async () => {
              assert.equal(
                workspaceRun.isWorkspaceRunReservedForItem(itemID),
                true,
              );
              erasedIDs.push(id);
              return true;
            },
          };
        },
      },
    };
    runtime.ztoolkit = {
      Reader: {
        getReader: async () => ({
          itemID,
          type: "pdf",
          setAnnotations: async () => {
            assert.ok(scenario.startsWith("refresh-"));
            controller.abort();
            if (scenario === "refresh-rejects")
              throw new Error("reader closed after cancel");
          },
        }),
      },
    };
    t.mock.method(workspaceRun, "startWorkspaceTextRun", async () => ({
      ok: true,
      workspacePath: "/owned",
      outputPath: "out",
      stderrPath: "err",
      exitCodePath: "exit",
      pidPath: "pid",
      promptPreview: "",
      processId: "424242",
    }));
    t.mock.method(workspaceRun, "readWorkspaceRunProgress", async () => ({
      completed: true,
      exitCode: "0",
      rawOutput: "",
      diagnosticOutput: "",
      parsedOutput: JSON.stringify({
        highlights: [{ quote: "first passage" }, { quote: "second passage" }],
      }),
    }));
    t.mock.method(cleanup, "cleanupWorkspaceIfEnabled", async () => false);
    t.mock.method(pdfMatch, "extractPdfTextPagesFromReader", async () => [
      { pageIndex: 0, pageLabel: "1", spans: [] },
    ]);
    t.mock.method(pdfMatch, "matchQuoteInPages", (quote: string) => ({
      quote,
      normalizedQuote: quote,
      pageIndex: 0,
      pageLabel: "1",
      rects: [[1, 2, 3, 4]],
      sortIndex: "00000|000001|00000",
    }));
    try {
      await assert.rejects(
        runAutoHighlightWorkflow({
          itemID,
          itemTitle: "Paper",
          signal: controller.signal,
        }),
        (error: unknown) => {
          assert.ok(error instanceof AutoHighlightCancelledError);
          assert.equal(error.keptHighlights, 0);
          return true;
        },
      );
      assert.deepEqual(erasedIDs, savedIDs);
      assert.equal(savedIDs.length, scenario === "save-rejects" ? 1 : 2);
      assert.equal(workspaceRun.isWorkspaceRunReservedForItem(itemID), false);
    } finally {
      Object.assign(runtime, previous);
    }
  });
}
