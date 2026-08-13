import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyOfficialEvidenceURL,
  headersFromXHR,
  inspectOfficialEvidenceURL,
  isPlausibleOfficialEvidenceURL,
  isNonPublicIPAddress,
} from "../src/modules/discovery/providers/officialEvidence";
import { withDiscoveryFetchTimeout } from "../src/modules/discovery/providers/types";
import {
  crossrefProvider,
  dblpProvider,
  openAlexProvider,
  semanticScholarProvider,
} from "../src/modules/discovery/providers/scholarly";
import {
  buildStructuredSeedQueries,
  searchCandidateProviders,
} from "../src/modules/discovery/providers/search";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", "discovery", name), "utf8");

test("official evidence shortcuts cover common AI and architecture publisher families", () => {
  assert.equal(
    classifyOfficialEvidenceURL("https://aclanthology.org/2026.acl-long.1")?.id,
    "acl-anthology",
  );
  assert.equal(
    classifyOfficialEvidenceURL(
      "https://openaccess.thecvf.com/content/CVPR2026/html/x",
    )?.id,
    "cvf",
  );
  assert.equal(
    classifyOfficialEvidenceURL("https://dl.acm.org/doi/10.1145/example")?.id,
    "acm",
  );
  assert.equal(
    classifyOfficialEvidenceURL("https://ieeexplore.ieee.org/document/123")?.id,
    "ieee",
  );
  assert.equal(
    classifyOfficialEvidenceURL("https://www.usenix.org/conference/example")
      ?.id,
    "usenix",
  );
});

test("generic official-web inspection supports unseen venues without a static allowlist", async () => {
  const inspected = await inspectOfficialEvidenceURL({
    url: "https://new-venue.example.org/program/paper-7",
    fetch: (async () =>
      new Response(fixture("official-page.html"), {
        status: 200,
      })) as typeof fetch,
  });
  assert.equal(inspected.sourceFamily, "generic-official-web");
  assert.equal(inspected.pageTitle, "Paper 7 - Main Program");
  assert.match(inspected.searchableText, /Accepted paper/);
  assert.equal(
    isPlausibleOfficialEvidenceURL("https://arxiv.org/abs/1"),
    false,
  );
  assert.equal(
    isPlausibleOfficialEvidenceURL("https://export.arxiv.org/abs/1"),
    false,
  );
  assert.equal(
    isPlausibleOfficialEvidenceURL("https://api.openalex.org/works/W1"),
    false,
  );
  assert.equal(isPlausibleOfficialEvidenceURL("http://localhost/paper"), false);
  assert.equal(
    isPlausibleOfficialEvidenceURL("https://172.20.0.1/paper"),
    false,
  );
  assert.equal(isPlausibleOfficialEvidenceURL("https://[::1]/paper"), false);
  for (const url of [
    "https://arxiv.org./abs/1",
    "https://dblp.org./rec/x",
    "https://localhost./paper",
    "https://foo.local./paper",
  ]) {
    assert.equal(isPlausibleOfficialEvidenceURL(url), false, url);
    assert.equal(classifyOfficialEvidenceURL(url), undefined, url);
  }
});

test("official evidence inspection refuses private redirects and does not consume PDFs", async () => {
  await assert.rejects(
    inspectOfficialEvidenceURL({
      url: "https://venue.example.org/paper",
      fetch: (async () =>
        ({
          ok: false,
          status: 302,
          url: "https://venue.example.org/paper",
          headers: new Headers({ location: "https://127.0.0.1/internal" }),
          body: new Response("private").body,
        }) as Response) as typeof fetch,
    }),
    /redirect left/,
  );

  let cancelled = false;
  const inspected = await inspectOfficialEvidenceURL({
    url: "https://venue.example.org/paper.pdf",
    fetch: (async () =>
      ({
        ok: true,
        status: 200,
        url: "https://venue.example.org/paper.pdf",
        headers: new Headers({ "content-type": "application/pdf" }),
        body: {
          cancel: async () => {
            cancelled = true;
          },
        } as ReadableStream,
      }) as Response) as typeof fetch,
  });
  assert.equal(inspected.bodyInspected, false);
  assert.equal(inspected.searchableText, "");
  assert.equal(cancelled, true);
});

test("official evidence rejects private DNS answers and mapped private IPv6", async () => {
  for (const address of [
    "::ffff:127.0.0.1",
    "::ffff:0a00:0001",
    "fec0::1",
    "64:ff9b::7f00:1",
    "100::1",
    "2001:2::1",
    "2002:7f00:1::",
  ]) {
    assert.equal(isNonPublicIPAddress(address), true, address);
  }
  assert.equal(isNonPublicIPAddress("2001:4860:4860::8888"), false);
  assert.equal(isNonPublicIPAddress("8.8.8.8"), false);
  await assert.rejects(
    inspectOfficialEvidenceURL({
      url: "https://public-name.example/paper",
      resolveHost: async () => ["169.254.169.254"],
      fetch: (async () => {
        assert.fail("private DNS targets must be rejected before fetch");
      }) as typeof fetch,
    }),
    /non-public address/,
  );
});

test("official evidence rejects malformed DNS answers fail closed", async () => {
  await assert.rejects(
    inspectOfficialEvidenceURL({
      url: "https://venue.example.org/program",
      resolveHost: async () => ["not-an-ip-address"],
      fetch: (async () => assert.fail("fetch must not start")) as typeof fetch,
    }),
    /non-public address/,
  );
});

test("official DNS lookup obeys cancellation and the absolute deadline", async () => {
  const never = async () => new Promise<string[]>(() => undefined);
  await assert.rejects(
    inspectOfficialEvidenceURL({
      url: "https://venue.example.org/program",
      resolveHost: never,
      fetch: (async () => assert.fail("fetch must not start")) as typeof fetch,
      deadline: Date.now() + 15,
    }),
    /DNS resolution timed out/i,
  );

  const controller = new AbortController();
  const cancelled = inspectOfficialEvidenceURL({
    url: "https://venue.example.org/program",
    resolveHost: never,
    signal: controller.signal,
    fetch: (async () => assert.fail("fetch must not start")) as typeof fetch,
  });
  controller.abort();
  await assert.rejects(cancelled, /cancelled/i);
});

test("Zotero-shaped fake redirect headers remain readable", () => {
  const headers = headersFromXHR({
    getResponseHeader(name: string) {
      return name.toLowerCase() === "location"
        ? "https://venue.example.org/final"
        : null;
    },
  });
  assert.equal(headers.get("location"), "https://venue.example.org/final");
});

test("injected official-evidence transport requires a public connected address when exposed", async () => {
  await assert.rejects(
    inspectOfficialEvidenceURL({
      url: "https://venue.example.org/paper",
      resolveHost: async () => ["8.8.8.8"],
      fetch: (async () => {
        const response = new Response(fixture("official-page.html"), {
          status: 200,
        }) as Response & { remoteAddress?: string };
        response.remoteAddress = "127.0.0.1";
        return response;
      }) as typeof fetch,
    }),
    /connection used a non-public address/,
  );
});

test("discovery timeout and outer cancellation remain active through body consumption", async () => {
  let streamController: ReadableStreamDefaultController<any> | undefined;
  const slowFetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          streamController = controller;
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  const timeoutResponse = await withDiscoveryFetchTimeout(
    slowFetch,
    20,
  )("https://provider.example/data");
  await assert.rejects(timeoutResponse.text(), /timed out|abort/i);
  streamController = undefined;

  const abortController = new AbortController();
  const cancelledResponse = await withDiscoveryFetchTimeout(
    slowFetch,
    5_000,
    abortController.signal,
  )("https://provider.example/data");
  abortController.abort(new Error("outer cancellation"));
  await assert.rejects(cancelledResponse.text(), /outer cancellation|abort/i);
  assert.ok(streamController, "body stream was created before cancellation");
});

test("Semantic Scholar is candidate discovery only and normalizes records", async () => {
  const candidates = await semanticScholarProvider.search("topic", {
    fetch: (async () =>
      new Response(fixture("provider-semantic-scholar.json"), {
        status: 200,
      })) as typeof fetch,
  });
  assert.equal(candidates[0].title, "Example Paper");
  assert.equal(candidates[0].provider, "semantic-scholar");
});

test("OpenAlex, DBLP, and Crossref fixtures normalize through their provider contracts", async () => {
  const fixtures = new Map([
    ["api.openalex.org", "provider-openalex.json"],
    ["dblp.org", "provider-dblp.json"],
    ["api.crossref.org", "provider-crossref.json"],
  ]);
  const fixtureFetch = (async (input: string | URL | Request) => {
    const hostname = new URL(String(input)).hostname;
    const name = fixtures.get(hostname);
    assert.ok(name, `unexpected provider host: ${hostname}`);
    return new Response(fixture(name), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const [openAlex, dblp, crossref] = await Promise.all([
    openAlexProvider.search("topic", { fetch: fixtureFetch }),
    dblpProvider.search("topic", { fetch: fixtureFetch }),
    crossrefProvider.search("topic", { fetch: fixtureFetch }),
  ]);
  assert.equal(openAlex[0].providerID, "W123");
  assert.equal(openAlex[0].authors[0], "Ada Researcher");
  assert.equal(dblp[0].title, "DBLP Example");
  assert.equal(dblp[0].authors[0], "Grace Author");
  assert.equal(crossref[0].doi, "10.1000/crossref");
  assert.equal(crossref[0].year, 2023);
});

test("structured discovery stops before provider work when cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    searchCandidateProviders({
      query: "topic",
      signal: controller.signal,
      providers: [
        {
          id: "must-not-run",
          async search() {
            assert.fail("cancelled provider search must not start");
          },
        },
      ],
    }),
    /cancelled/i,
  );
});

test("structured discovery supplies distinct problem, method, evaluation, and recent query families", () => {
  const seeds = buildStructuredSeedQueries({
    title: "A New Architecture",
    concern: "Does this scheduling idea already exist?",
  });
  assert.deepEqual(
    seeds.map((seed) => seed.family),
    [
      "problem_setting",
      "method_mechanism",
      "evaluation",
      "alternatives_recent",
    ],
  );
  assert.equal(new Set(seeds.map((seed) => seed.query)).size, 4);
});
