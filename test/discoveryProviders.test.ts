import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyOfficialEvidenceURL,
  inspectOfficialEvidenceURL,
  isPlausibleOfficialEvidenceURL,
} from "../src/modules/discovery/providers/officialEvidence";
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
});

test("official evidence inspection refuses private redirects and does not consume PDFs", async () => {
  await assert.rejects(
    inspectOfficialEvidenceURL({
      url: "https://venue.example.org/paper",
      fetch: (async () =>
        ({
          ok: true,
          status: 200,
          url: "https://127.0.0.1/internal",
          headers: new Headers({ "content-type": "text/html" }),
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
