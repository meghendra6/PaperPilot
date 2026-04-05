import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  addRecommendationToCollection,
  buildOpenTarget,
  buildRecommendationMetadataLine,
  buildRelatedPaperQuestion,
  chooseCollectionForRecommendation,
  findExistingLibraryItem,
  normalizeDOI,
  openRecommendedPaper,
  parseRelatedPaperResponse,
} from "../src/modules/relatedRecommendations";

test("parseRelatedPaperResponse extracts fenced JSON and sorts preferred categories and scores", () => {
  const response = parseRelatedPaperResponse(`Here you go:\n\n\
\`\`\`json
{"groups":[
  {"category":"Applications / extensions","papers":[{"title":"Paper B","authors":["B Author"],"relevanceScore":0.4}]},
  {"category":"Closest match","papers":[
    {"title":"Paper C","authors":["C Author"],"relevanceScore":0.6},
    {"title":"Paper A","authors":["A Author"],"relevanceScore":0.9}
  ]}
]}
\`\`\``);

  assert.equal(response.groups[0].category, "Closest match");
  assert.deepEqual(
    response.groups[0].papers.map((paper) => paper.title),
    ["Paper A", "Paper C"],
  );
  assert.equal(response.groups[1].category, "Applications / extensions");
});

test("parseRelatedPaperResponse rejects payloads without usable groups", () => {
  assert.throws(
    () => parseRelatedPaperResponse('{"groups":[]}'),
    /did not include any usable groups/i,
  );
});

test("findExistingLibraryItem prefers DOI over title fallback", () => {
  const match = findExistingLibraryItem(
    {
      title: "Matching Paper",
      doi: "10.1000/test",
      year: 2024,
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
    },
    [{ id: 30, title: "A Great Paper Findings", year: 2023 }],
  );

  assert.equal(match?.id, 30);
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
    "Ada Lovelace, Grace Hopper · 2024 · ICML · Relevance 70%",
  );

  assert.deepEqual(buildOpenTarget({ doi: "https://doi.org/10.5555/ABC" }), {
    kind: "external",
    url: "https://doi.org/10.5555/abc",
  });
  assert.equal(normalizeDOI("10.5555/ABC"), "10.5555/abc");
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

  assert.match(question, /Return ONLY strict JSON/i);
  assert.match(question, /Title: Current Paper/);
  assert.match(question, /Authors: Author One, Author Two/);
  assert.match(question, /Abstract: Important abstract\./);
  assert.match(question, /reasonably confident are real/i);
  assert.match(question, /grounded in topic\/method\/task overlap/i);
  assert.match(question, /Provide 3 to 5 groups\./);
  assert.match(
    question,
    /Closest match, Foundational \/ background, Methods \/ technique, Applications \/ extensions, Contrasting \/ alternative/,
  );
  assert.match(question, /Prefer papers with DOI or URL when possible\./);
  assert.match(question, /Do not include markdown fences or prose\./);
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
  const existingItem = { id: 99 };
  (globalThis as any).Zotero = {
    Items: {
      getAsync: async () => ({ libraryID: 1 }),
      getAll: async () => [],
      get: (id: number) => ({ ...existingItem, id }),
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
      authors: [],
      relevanceScore: 0.9,
      existingItemID: 99,
    },
  });

  assert.deepEqual(addCalls, [[99]]);
  assert.deepEqual(result, {
    itemID: 99,
    collectionID: 5,
    reusedExistingItem: true,
  });
});
