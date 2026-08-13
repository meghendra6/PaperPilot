import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  addItemsToCollection,
  addRecommendationToCollection,
  buildOpenTarget,
  buildRecommendationMetadataLine,
  buildRelatedPaperQuestion,
  chooseCollectionForRecommendation,
  findExistingLibraryItem,
  generateRelatedPaperGroups,
  normalizeDOI,
  openRecommendedPaper,
  parseRelatedPaperResponse,
} from "../src/modules/relatedRecommendations";

test("addItemsToCollection uses Zotero's required DB transaction boundary", async () => {
  const calls: string[] = [];
  const previousZotero = (globalThis as { Zotero?: unknown }).Zotero;
  (globalThis as { Zotero?: unknown }).Zotero = {
    DB: {
      executeTransaction: async (callback: () => Promise<void>) => {
        calls.push("transaction:start");
        await callback();
        calls.push("transaction:end");
      },
    },
  };
  try {
    await addItemsToCollection(
      {
        addItems: async (ids) => {
          calls.push(`add:${ids.join(",")}`);
        },
      },
      [7, 8],
    );
    assert.deepEqual(calls, [
      "transaction:start",
      "add:7,8",
      "transaction:end",
    ]);
  } finally {
    (globalThis as { Zotero?: unknown }).Zotero = previousZotero;
  }
});
import {
  claimRetryEngineRequest,
  releaseRetryEngineRequest,
} from "../src/modules/ai/runLifecycle";

test("rejected Related admission does not invoke persistence callbacks", async () => {
  const previousAddon = (globalThis as { addon?: unknown }).addon;
  (globalThis as { addon?: unknown }).addon = {
    data: { modeOverrides: new Map([[91, "codex_cli"]]) },
  };
  const retryToken = claimRetryEngineRequest(91);
  assert.ok(retryToken);
  let reservedCallbacks = 0;
  let failureCallbacks = 0;

  try {
    await assert.rejects(
      generateRelatedPaperGroups({
        itemID: 91,
        itemTitle: "Paper",
        onReserved: () => {
          reservedCallbacks += 1;
        },
        onFailure: () => {
          failureCallbacks += 1;
        },
      }),
      /already active/i,
    );
    assert.equal(reservedCallbacks, 0);
    assert.equal(failureCallbacks, 0);
  } finally {
    releaseRetryEngineRequest(91, retryToken);
    (globalThis as { addon?: unknown }).addon = previousAddon;
  }
});

test("parseRelatedPaperResponse rejects legacy unverified recommendation groups", () => {
  assert.throws(
    () =>
      parseRelatedPaperResponse(
        '{"groups":[{"category":"Closest match","papers":[{"title":"Model memory","url":"javascript:alert(1)"}]}]}',
      ),
    /legacy recommendation groups are not accepted/i,
  );
});

test("findExistingLibraryItem prefers DOI over title fallback", () => {
  const match = findExistingLibraryItem(
    {
      title: "Matching Paper",
      doi: "10.1000/test",
      year: 2024,
      authors: ["Ada Author"],
    },
    [
      { id: 20, title: "Matching Paper", year: 2024 },
      { id: 10, title: "Different Paper", doi: "https://doi.org/10.1000/test" },
    ],
  );

  assert.equal(match?.id, 10);
});

test("findExistingLibraryItem falls back to normalized title and year", () => {
  const match = findExistingLibraryItem(
    {
      title: "A Great Paper: Findings",
      year: 2023,
      authors: ["Ada Author"],
    },
    [
      {
        id: 30,
        title: "A Great Paper Findings",
        year: 2023,
        authors: ["A. Author"],
      },
    ],
  );

  assert.equal(match?.id, 30);
});

test("findExistingLibraryItem does not bind an ambiguous same-title paper", () => {
  const candidates = [
    {
      id: 40,
      title: "Shared Generic Title",
      year: 2024,
      authors: ["Alice Researcher"],
    },
  ];
  assert.equal(
    findExistingLibraryItem(
      {
        title: "Shared Generic Title",
        authors: ["Bob Scholar"],
        providerIDs: {},
      },
      candidates,
    ),
    undefined,
  );
  assert.equal(
    findExistingLibraryItem(
      {
        title: "Shared Generic Title",
        year: 2024,
        authors: ["Bob Scholar"],
        providerIDs: {},
      },
      candidates,
    ),
    undefined,
  );
});

test("buildRecommendationMetadataLine and buildOpenTarget cover DOI fallback", () => {
  assert.equal(
    buildRecommendationMetadataLine({
      title: "Paper",
      authors: ["Ada Lovelace", "Grace Hopper"],
      relevanceScore: 0.7,
      year: 2024,
      venue: "ICML",
    }),
    "Ada Lovelace, Grace Hopper · 2024 · ICML",
  );

  assert.deepEqual(buildOpenTarget({ doi: "https://doi.org/10.5555/ABC" }), {
    kind: "external",
    url: "https://doi.org/10.5555/abc",
  });
  assert.equal(normalizeDOI("10.5555/ABC"), "10.5555/abc");
});

test("pre-gate open target cannot fall through to an OpenReview forum", () => {
  assert.deepEqual(
    buildOpenTarget(
      {
        doi: "10.5555/safe",
        url: "https://openreview.net/forum?id=secret",
        urls: ["https://openreview.net/forum?id=secret"],
        reviewURL: "https://openreview.net/forum?id=secret",
      },
      { includeReviewURL: false },
    ),
    { kind: "external", url: "https://doi.org/10.5555/safe" },
  );
});

test("buildRelatedPaperQuestion includes the current paper context", () => {
  const question = buildRelatedPaperQuestion({
    getField: (field: string) => {
      if (field === "title") return "Current Paper";
      if (field === "year") return "2025";
      if (field === "abstractNote") return "Important abstract.";
      return "";
    },
    getCreators: () => [
      { firstName: "Author", lastName: "One" },
      { firstName: "Author", lastName: "Two" },
    ],
  } as any);

  assert.match(question, /Return ONLY one strict JSON/i);
  assert.match(question, /Title: Current Paper/);
  assert.match(question, /Authors: Author One, Author Two/);
  assert.match(question, /Abstract: Important abstract\./);
  assert.match(question, /user must not be asked to choose fields or venues/i);
  assert.match(question, /leading archival venues/i);
  assert.match(question, /open-world/i);
  assert.match(question, /paper-level official proceedings/i);
  assert.match(question, /workshops, Findings, demos, industry tracks/i);
  assert.match(question, /arXiv-only work as main papers/i);
  assert.match(question, /verifiedMain/);
  assert.match(question, /otherPeerReviewed/);
  assert.match(question, /noveltyRadar/);
  assert.match(question, /use full workspace content/i);
});

test("chooseCollectionForRecommendation prefers the currently selected collection", async () => {
  const selectedCollection = { id: 7, name: "Current Collection", parentID: 0 };
  (globalThis as any).Zotero = {
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollection: () => selectedCollection,
      },
    }),
    Collections: {
      getByLibrary: () => [],
    },
  };

  const result = await chooseCollectionForRecommendation({ libraryID: 1 });
  assert.equal(result, selectedCollection);
});

test("openRecommendedPaper opens an existing Zotero item via the main pane", async () => {
  const calls: Array<string | number> = [];
  (globalThis as any).Zotero = {
    getMainWindow: () => ({
      ZoteroPane: {
        selectItem: async (itemID: number) => {
          calls.push(itemID);
          return true;
        },
      },
    }),
    launchURL: (url: string) => calls.push(url),
  };
  (globalThis as any).Zotero_Tabs = {
    select: (tabID: string) => calls.push(tabID),
  };

  await openRecommendedPaper({
    title: "Paper",
    authors: [],
    relevanceScore: 0.8,
    existingItemID: 42,
  });

  assert.deepEqual(calls, ["zotero-pane", 42]);
});

test("addRecommendationToCollection reuses an existing item and adds it to the chosen collection", async () => {
  const addCalls: number[][] = [];
  const fields: Record<string, string> = {
    title: "Paper",
    year: "2026",
    date: "2026",
  };
  let saveCalls = 0;
  const existingItem = { id: 99 };
  (globalThis as any).Zotero = {
    Items: {
      getAsync: async () => ({ libraryID: 1 }),
      getAll: async () => [
        {
          id: 99,
          isAttachment: () => false,
          isNote: () => false,
          getField: (field: string) => fields[field] || "",
          getCreators: () => [{ firstName: "Ada", lastName: "Author" }],
        },
      ],
      get: (id: number) => ({
        ...existingItem,
        id,
        getField: (field: string) => fields[field] || "",
        setField: (field: string, value: string) => {
          fields[field] = value;
        },
        saveTx: async () => {
          saveCalls += 1;
        },
      }),
    },
    Collections: {
      get: (id: number) => ({
        id,
        name: "Collection",
        parentID: 0,
        hasItem: () => false,
        addItems: async (ids: number[]) => addCalls.push(ids),
      }),
      getByLibrary: () => [],
    },
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollection: () => ({
          id: 5,
          name: "Collection",
          parentID: 0,
        }),
      },
    }),
    Item: function () {
      throw new Error(
        "Should not create a new item when existingItemID is present.",
      );
    },
  };

  const result = await addRecommendationToCollection({
    sourceItemID: 1,
    paper: {
      title: "Paper",
      authors: ["Ada Author"],
      year: 2026,
      relevanceScore: 0.9,
      existingItemID: 99,
      doi: "10.5555/candidate",
      venue: "Example Conference",
      url: "https://openreview.net/forum?id=hidden",
      urls: ["https://publisher.example/paper"],
      reviewURL: "https://openreview.net/forum?id=hidden",
    },
    includeReviewURL: false,
  });

  assert.deepEqual(addCalls, [[99]]);
  assert.deepEqual(result, {
    itemID: 99,
    collectionID: 5,
    reusedExistingItem: true,
  });
  assert.equal(fields.DOI, "10.5555/candidate");
  assert.equal(fields.publicationTitle, "Example Conference");
  assert.equal(fields.url, "https://publisher.example/paper");
  assert.ok(saveCalls > 0);
});
