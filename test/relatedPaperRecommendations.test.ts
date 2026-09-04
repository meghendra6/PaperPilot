import { afterEach, test } from "node:test";
import * as assert from "node:assert/strict";

import {
  addItemsToCollection,
  addRecommendationToCollection,
  buildOpenTarget,
  buildRecommendationMetadataLine,
  buildRelatedPaperQuestion,
  buildRelatedRunFailureState,
  buildRelatedRunProgressState,
  buildRelatedRunSuccessState,
  chooseCollectionForRecommendation,
  findExistingLibraryItem,
  generateRelatedPaperGroups,
  normalizeDOI,
  normalizeDiscoveryRunFailure,
  openRecommendedPaper,
  parseRelatedPaperResponse,
  type RelatedRunSubmission,
} from "../src/modules/relatedRecommendations";
import { releaseReservationAfterConfirmedCleanup } from "../src/modules/ai/workspaceRun";
import { createGlobalStateRestorer } from "./helpers/globalState";

const restoreGlobals = createGlobalStateRestorer([
  "Services",
  "Zotero",
  "Zotero_Tabs",
]);
afterEach(restoreGlobals);

test("related-run states stay bound to the submitted concern, not later edits", () => {
  const submission: RelatedRunSubmission = {
    concern: "submitted concern",
    concernOrigin: "user_text",
    previousState: {
      sessionID: "session-1",
      running: false,
      status: "Previous result",
      groups: [{ category: "Verified main-conference papers", papers: [] }],
      concern: "previous concern",
      concernOrigin: "selection",
    },
  };
  const progress = buildRelatedRunProgressState(
    {
      sessionID: "session-1",
      running: false,
      status: "",
      groups: [],
      concern: "edited mid-run concern",
      concernOrigin: "user_text",
    },
    submission,
    "Searching scholarly providers",
  );
  assert.equal(progress.running, true);
  assert.equal(progress.concern, "submitted concern");
  const success = buildRelatedRunSuccessState({
    submission,
    sessionID: "session-1",
    groups: [
      {
        category: "Verified main-conference papers",
        papers: [{ title: "Paper", authors: [], relevanceScore: 0.5 }],
      },
    ],
  });
  assert.equal(success.running, false);
  assert.equal(success.concern, "submitted concern");
  assert.equal(success.concernOrigin, "user_text");
  assert.match(success.status, /Found 1 papers/);
});

test("related-run failure restores the pre-run recommendation scope", () => {
  const submission: RelatedRunSubmission = {
    concern: "submitted concern",
    concernOrigin: "user_text",
    previousState: {
      sessionID: "session-1",
      running: false,
      status: "Previous result",
      groups: [{ category: "Verified main-conference papers", papers: [] }],
      concern: "previous concern",
      concernOrigin: "selection",
    },
  };
  const failure = buildRelatedRunFailureState({
    submission,
    sessionID: "session-1",
    error: new Error("Discovery cancelled."),
  });
  assert.equal(failure.running, false);
  assert.equal(failure.status, "Discovery cancelled.");
  assert.equal(failure.concern, "previous concern");
  assert.equal(failure.concernOrigin, "selection");
  assert.deepEqual(failure.groups, submission.previousState.groups);
});

test("aborted non-Error rejections normalize to a cancellation error", () => {
  // A window-owned AbortController rejects with a DOMException from another
  // compartment, which fails `instanceof Error` in plugin code and would
  // otherwise surface as a generic failure after a user-initiated cancel.
  const failure = normalizeDiscoveryRunFailure({ name: "AbortError" }, true);
  assert.ok(failure instanceof Error);
  assert.equal((failure as Error).message, "Research discovery cancelled.");
});

test("aborted Error rejections keep their specific message", () => {
  const error = new Error(
    "Codex CLI related-paper process could not be stopped. Its workspace remains reserved until Zotero restarts.",
  );
  assert.equal(normalizeDiscoveryRunFailure(error, true), error);
});

test("non-aborted failures pass through unchanged", () => {
  const raw = { message: "boom" };
  assert.equal(normalizeDiscoveryRunFailure(raw, false), raw);
});

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
      { id: 20, title: "Matching Paper", year: 2024, authors: ["Ada Author"] },
      { id: 10, title: "Matching Paper", doi: "https://doi.org/10.1000/test" },
    ],
  );

  assert.equal(match?.id, 10);
});

test("findExistingLibraryItem rejects a copied identifier on a conflicting item", () => {
  const recommended = {
    title: "Verified Paper",
    authors: ["Alice Author"],
    year: 2026,
    doi: "10.1234/copied",
    providerIDs: { openalex: "W77" },
  };
  const adversarial = {
    id: 77,
    title: "Unrelated Adversarial Paper",
    authors: ["Mallory Adversary"],
    year: 2019,
    doi: "10.1234/copied",
    providerIDs: { openalex: "W77" },
  };
  assert.equal(findExistingLibraryItem(recommended, [adversarial]), undefined);
  assert.equal(
    findExistingLibraryItem(recommended, [
      adversarial,
      {
        id: 78,
        title: "Verified Paper",
        authors: ["Alice Author"],
        year: 2026,
        doi: "https://doi.org/10.1234/copied",
      },
    ])?.id,
    78,
  );
});

test("workspace reservations stay held when late cleanup cannot confirm the stop", async () => {
  let released = 0;
  releaseReservationAfterConfirmedCleanup(
    Promise.reject(new Error("kill failed")),
    () => {
      released += 1;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 0);
  releaseReservationAfterConfirmedCleanup(Promise.resolve(), () => {
    released += 1;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 1);
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
  assert.match(question, /"title":"Current Paper"/);
  assert.match(question, /"authors":\["Author One","Author Two"\]/);
  assert.match(question, /"abstract":"Important abstract\."/);
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

test("chooseCollectionForRecommendation uses the Zotero 10 plural collection getter", async () => {
  const selectedCollection = {
    id: 7,
    name: "Current Collection",
    parentID: 0,
    libraryID: 1,
  };
  (globalThis as any).Zotero = {
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollections: () => [selectedCollection],
        getSelectedCollection: () => {
          throw new Error("Zotero 10 singular getter must not be called");
        },
      },
    }),
    Collections: {
      getByLibrary: () => [],
    },
  };

  const result = await chooseCollectionForRecommendation({ libraryID: 1 });
  assert.equal(result, selectedCollection);
});

test("chooseCollectionForRecommendation prompts instead of choosing arbitrarily from a Zotero 10 multi-selection", async () => {
  const first = { id: 7, name: "First", parentID: 0, libraryID: 1 };
  const second = { id: 8, name: "Second", parentID: 0, libraryID: 1 };
  (globalThis as any).Zotero = {
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollections: () => [first, second],
      },
    }),
    Collections: {
      getByLibrary: () => [first, second],
    },
  };
  (globalThis as any).Services = {
    prompt: {
      select: (
        _parent: unknown,
        _title: string,
        _message: string,
        _count: number,
        _labels: string[],
        selected: { value: number },
      ) => {
        selected.value = 1;
        return true;
      },
    },
  };

  try {
    assert.equal(
      await chooseCollectionForRecommendation({ libraryID: 1 }),
      second,
    );
  } finally {
    delete (globalThis as any).Services;
  }
});

test("chooseCollectionForRecommendation ignores a selected collection from another library", async () => {
  const valid = { id: 11, name: "Source Library", parentID: 0, libraryID: 1 };
  (globalThis as any).Zotero = {
    getMainWindow: () => ({
      ZoteroPane: {
        getSelectedCollection: () => ({
          id: 22,
          name: "Other Library",
          parentID: 0,
          libraryID: 2,
        }),
      },
    }),
    Collections: {
      getByLibrary: (libraryID: number) => (libraryID === 1 ? [valid] : []),
    },
  };
  assert.equal(
    await chooseCollectionForRecommendation({ libraryID: 1 }),
    valid,
  );
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
        libraryID: 1,
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
          libraryID: 1,
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
  assert.equal(fields.DOI, undefined);
  assert.equal(fields.publicationTitle, undefined);
  assert.equal(fields.url, undefined);
  assert.match(fields.extra, /Suggested DOI.*10\.5555\/candidate/);
  assert.match(fields.extra, /Suggested venue.*Example Conference/);
  assert.match(fields.extra, /Suggested URL.*publisher\.example/);
  assert.ok(saveCalls > 0);
});
