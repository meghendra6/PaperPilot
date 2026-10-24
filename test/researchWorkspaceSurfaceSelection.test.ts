import { test } from "node:test";
import * as assert from "node:assert/strict";

import type { ResearchWorkspaceSnapshotLoadResult } from "../src/modules/researchWorkspace/selectionSnapshot";
import {
  createResearchWorkspaceSurfaceSelection,
  createSelectionReadController,
  defaultResearchWorkspaceProjectName,
  describeResearchWorkspaceSkip,
  formatResearchWorkspaceDay,
  papersLabel,
  summarizeResearchWorkspaceSelection,
} from "../src/modules/researchWorkspace/surfaceSelection";
import { loadSelectionPapers } from "../src/modules/researchWorkspace/projectSurfaceShared";
import { runResearchWorkspaceSurfaceAction } from "../src/modules/researchWorkspace/surfaceAction";

function snapshot(titles: string[], skipped = 0) {
  return {
    id: "snapshot-1",
    selectedCount: titles.length + skipped,
    candidates: titles.map((title, index) => ({
      selectedIndex: index,
      selectedItemID: index + 1,
      sourceID: `zotero:1:ITEM${index}:PDF${index}`,
      libraryID: 1,
      itemID: index + 1,
      itemKey: `ITEM${index}`,
      attachmentID: index + 100,
      attachmentKey: `PDF${index}`,
      title,
    })),
    skipped: Array.from({ length: skipped }, (_, index) => ({
      selectedIndex: titles.length + index,
      title: `Skipped ${index}`,
      code: "no-pdf" as const,
      reason: "No PDF attachment was found.",
    })),
  };
}

// Only the identity matters here; the selection never reads paper fields.
const LOADED: ResearchWorkspaceSnapshotLoadResult = {
  papers: [
    {
      sourceID: "zotero:1:ITEM0:PDF0",
    } as unknown as ResearchWorkspaceSnapshotLoadResult["papers"][number],
  ],
  skipped: [],
};

test("PDF selection uses the window AbortController when the Zotero sandbox has none", () => {
  const runtime = globalThis as typeof globalThis & { Zotero?: unknown };
  const originalController = runtime.AbortController;
  const originalZotero = runtime.Zotero;
  try {
    Object.assign(runtime, {
      AbortController: undefined,
      Zotero: {
        getMainWindow: () => ({ AbortController: originalController }),
      },
    });
    const controller = createSelectionReadController();
    assert.equal(controller.signal.aborted, false);
    controller.abort();
    assert.equal(controller.signal.aborted, true);
  } finally {
    Object.assign(runtime, { AbortController: originalController });
    if (originalZotero === undefined) Reflect.deleteProperty(runtime, "Zotero");
    else runtime.Zotero = originalZotero;
  }
});

test("a surface selection reads its PDFs once and shares the result", async () => {
  let reads = 0;
  const selection = createResearchWorkspaceSurfaceSelection(
    snapshot(["A", "B"]),
    async () => {
      reads += 1;
      return LOADED;
    },
  );
  assert.equal(selection.loaded(), undefined);
  const [first, second] = await Promise.all([
    selection.load(),
    selection.load(),
  ]);
  assert.equal(first, second);
  assert.equal(await selection.load(), first);
  assert.equal(reads, 1);
  assert.equal(selection.loaded(), first);
  assert.deepEqual(selection.titles, ["A", "B"]);
  assert.deepEqual(selection.sourceIDs, [
    "zotero:1:ITEM0:PDF0",
    "zotero:1:ITEM1:PDF1",
  ]);
});

test("a failed read is not cached, so the next action tries again", async () => {
  let reads = 0;
  const selection = createResearchWorkspaceSurfaceSelection(
    snapshot(["A"]),
    async () => {
      reads += 1;
      if (reads === 1) throw new Error("extractor unavailable");
      return LOADED;
    },
  );
  await assert.rejects(selection.load(), /extractor unavailable/);
  assert.equal(selection.loaded(), undefined);
  assert.equal(await selection.load(), LOADED);
  assert.equal(reads, 2);
});

test("a read where every PDF failed is not cached either", async () => {
  let reads = 0;
  const failed: ResearchWorkspaceSnapshotLoadResult = {
    papers: [],
    skipped: [
      {
        selectedIndex: 0,
        title: "A",
        code: "load-failed",
        reason: "The extractor could not read the PDF.",
      },
    ],
  };
  const selection = createResearchWorkspaceSurfaceSelection(
    snapshot(["A"]),
    async () => {
      reads += 1;
      return reads === 1 ? failed : LOADED;
    },
  );
  assert.equal(await selection.load(), failed);
  assert.equal(selection.loaded(), undefined);
  // The PDF was repaired; the next action reads it again.
  assert.equal(await selection.load(), LOADED);
  assert.equal(reads, 2);
});

test("a stalled selection times out, releases the create action, and ignores late results after retry", async () => {
  let finishOld!: (value: ResearchWorkspaceSnapshotLoadResult) => void;
  const oldRead = new Promise<ResearchWorkspaceSnapshotLoadResult>(
    (resolve) => {
      finishOld = resolve;
    },
  );
  let oldSignal: AbortSignal | undefined;
  let oldStatus: ((message: string) => void) | undefined;
  let reads = 0;
  const status: string[] = [];
  const selection = createResearchWorkspaceSurfaceSelection(
    snapshot(["A"]),
    async (options) => {
      reads++;
      if (reads === 1) {
        oldSignal = options.signal;
        oldStatus = options.onStatus;
        options.onStatus?.("Reading PDF 1 of 1: reading Zotero text…");
        return oldRead;
      }
      return LOADED;
    },
    { timeoutMs: 5 },
  );
  const attributes = new Map<string, string>();
  const surface = {
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => {
      attributes.delete(key);
    },
  };
  const trigger = { disabled: false };
  let created = 0;
  const errors: unknown[] = [];
  const create = () =>
    runResearchWorkspaceSurfaceAction({
      surface,
      trigger,
      action: async () => {
        await loadSelectionPapers(selection, (message) => status.push(message));
        created++;
      },
      onError: (error) => errors.push(error),
    });
  assert.equal(await create(), false);
  assert.equal(created, 0);
  assert.equal(oldSignal?.aborted, true);
  assert.equal(trigger.disabled, false);
  assert.equal(attributes.has("aria-busy"), false);
  assert.match(String(errors[0]), /timed out/i);
  assert.equal(await create(), true);
  assert.equal(created, 1);
  assert.equal(reads, 2);
  const beforeLate = [...status];
  oldStatus?.("Old read finished");
  finishOld({ papers: [], skipped: [] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(selection.loaded(), LOADED);
  assert.deepEqual(status, beforeLate);
  assert.equal(await selection.load(), LOADED);
  assert.equal(reads, 2);
});

test("failed PDF loading explains the stalled stage instead of hiding it behind a generic error", async () => {
  const selection = createResearchWorkspaceSurfaceSelection(
    snapshot(["A"]),
    async () => ({
      papers: [],
      skipped: [
        {
          selectedIndex: 0,
          title: "A",
          code: "load-failed",
          reason: "Reading Zotero PDF text timed out.",
        },
      ],
    }),
  );
  await assert.rejects(
    loadSelectionPapers(selection, () => {}),
    /Reading Zotero PDF text timed out/,
  );
});

test("the selection summary counts papers and skipped items", () => {
  const titles = ["A", "B", "C", "D", "E", "F", "G"];
  const summary = summarizeResearchWorkspaceSelection({
    titles,
    skipped: snapshot([], 2).skipped,
  });
  assert.equal(summary.headline, "7 papers with a PDF selected in Zotero");
  assert.equal(summary.skippedLine, "2 selected items were skipped.");
  assert.deepEqual(summary.visibleTitles, ["A", "B", "C", "D", "E"]);
  assert.equal(summary.hiddenCount, 2);

  const one = summarizeResearchWorkspaceSelection({
    titles: ["A"],
    skipped: [],
  });
  assert.equal(one.headline, "1 paper with a PDF selected in Zotero");
  assert.equal(one.skippedLine, "");
  assert.equal(
    summarizeResearchWorkspaceSelection({ titles: [], skipped: [] }).headline,
    "No selected item has a readable PDF",
  );
});

test("a single paper names its project; several papers get a dated set", () => {
  const date = new Date("2026-10-24T12:00:00.000Z");
  assert.equal(
    defaultResearchWorkspaceProjectName(["  Attention Is All You Need "], date),
    "Attention Is All You Need",
  );
  const long = "x".repeat(120);
  assert.equal(defaultResearchWorkspaceProjectName([long], date).length, 80);
  assert.equal(
    defaultResearchWorkspaceProjectName(["A", "B"], date),
    `Research set (${formatResearchWorkspaceDay(date)})`,
  );
});

test("dates read in the interface language, not the system locale", () => {
  assert.equal(
    formatResearchWorkspaceDay(new Date(2026, 9, 24)),
    "Oct 24, 2026",
  );
  assert.equal(
    formatResearchWorkspaceDay(new Date(2026, 0, 3).toISOString()),
    "Jan 3, 2026",
  );
});

test("skip codes read as plain reasons and counts pluralize", () => {
  assert.equal(describeResearchWorkspaceSkip("no-pdf"), "no PDF attached");
  assert.equal(
    describeResearchWorkspaceSkip("selection-limit"),
    "over the 12-paper limit",
  );
  assert.equal(papersLabel(1), "1 paper");
  assert.equal(papersLabel(3), "3 papers");
});
