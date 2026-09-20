import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDictionaryLookup,
  dictionaryRequestURL,
  parseNaverDictionaryResponse,
} from "../src/modules/dictionaryLookup";

test("dictionary lookup uses the official Naver mini dictionary", () => {
  assert.deepEqual(buildDictionaryLookup("retrieval"), {
    term: "retrieval",
    url: "https://en.dict.naver.com/#/mini/search?query=retrieval",
  });
});

function entry(headword = "example", extra: Record<string, unknown> = {}) {
  return {
    expEntry: `<strong>${headword}</strong>`,
    matchType: "exact:entry",
    meansCollector: [{ partOfSpeech: "명사", means: [{ value: "시험용 뜻" }] }],
    sourceDictnameKO: "Test dictionary",
    destinationLink: "#/entry/enko/0123456789abcdef0123456789abcdef",
    ...extra,
  };
}

function response(items: unknown[], query = "example") {
  return {
    searchResultMap: { searchResultListMap: { WORD: { query, items } } },
  };
}

test("dictionary request uses only a bounded encoded term and fixed search options", () => {
  const lookup = buildDictionaryLookup("R&D #1");
  assert.ok(lookup);
  const url = new URL(dictionaryRequestURL(lookup));
  assert.equal(url.origin, "https://en.dict.naver.com");
  assert.equal(url.pathname, "/api3/enko/search");
  assert.equal(url.searchParams.get("query"), "R&D #1");
  assert.equal(url.searchParams.get("shouldSearchOpen"), "false");
});

test("dictionary parser selects the matching headword rather than a related result", () => {
  const lookup = {
    term: "example",
    url: "https://en.dict.naver.com/#/mini/search?query=example",
  };
  const parsed = parseNaverDictionaryResponse(
    response([entry("for example"), entry("EXAMPLE")]),
    lookup,
  );
  assert.equal(parsed?.headword, "EXAMPLE");
  assert.deepEqual(parsed?.senses, [
    { partOfSpeech: "명사", meaning: "시험용 뜻" },
  ]);
  assert.equal(parsed?.source, "Test dictionary");
  assert.equal(
    parsed?.url,
    "https://en.dict.naver.com/#/entry/enko/0123456789abcdef0123456789abcdef",
  );
});

test("dictionary parser exposes inflection headwords but does not substitute loose matches", () => {
  const lookup = { term: "models", url: "https://en.dict.naver.com/" };
  assert.equal(
    parseNaverDictionaryResponse(
      response([entry("model", { matchType: "exact:subEntry" })], "models"),
      lookup,
    )?.headword,
    "model",
  );
  assert.equal(
    parseNaverDictionaryResponse(
      response(
        [entry("many models", { matchType: "allterm:proximity:1.000000" })],
        "models",
      ),
      lookup,
    ),
    undefined,
  );
});

test("dictionary parser bounds meanings, strips markup, decodes entities, and ignores unsafe links", () => {
  const lookup = { term: "example", url: "https://en.dict.naver.com/" };
  const parsed = parseNaverDictionaryResponse(
    response([
      entry("example", {
        meansCollector: [
          {
            partOfSpeech: "<b>명사</b>",
            means: [
              {
                value:
                  "<script>untrusted()</script><strong>첫째</strong>&nbsp;&amp; &#xB73B;",
              },
              { value: "둘째" },
              { value: "둘째" },
              { value: "셋째" },
              { value: "넷째" },
            ],
          },
        ],
        searchPhoneticSymbolList: [
          { symbolValue: "<b>test</b>" },
          { symbolValue: "test" },
          { symbolValue: "" },
        ],
        destinationLink: "javascript:alert(1)",
      }),
    ]),
    lookup,
  );
  assert.deepEqual(
    parsed?.senses.map((s) => s.meaning),
    ["첫째 & 뜻", "둘째", "셋째"],
  );
  assert.deepEqual(parsed?.pronunciations, ["test"]);
  assert.equal(parsed?.url, lookup.url);
});

test("dictionary parser distinguishes no match from malformed or unrelated responses", () => {
  const lookup = { term: "example", url: "https://en.dict.naver.com/" };
  assert.equal(parseNaverDictionaryResponse(response([]), lookup), undefined);
  for (const payload of [
    null,
    {},
    response([], "other"),
    response([entry("example", { meansCollector: null })]),
  ]) {
    assert.throws(() => parseNaverDictionaryResponse(payload, lookup));
  }
});

test("dictionary parser handles the cost response shape across noun and verb groups", () => {
  const parsed = parseNaverDictionaryResponse(
    response(
      [
        entry("cost", {
          meansCollector: [
            {
              partOfSpeech: "명사",
              means: [{ value: "비용" }, { value: "경비" }],
            },
            {
              partOfSpeech: "동사",
              means: [{ value: "들다" }, { value: "희생시키다" }],
            },
          ],
          searchPhoneticSymbolList: [
            { symbolValue: "kɔːst" },
            { symbolValue: "kɒst" },
          ],
        }),
        entry("costly", { matchType: "exact:subEntry" }),
      ],
      "cost",
    ),
    { term: "cost", url: "https://en.dict.naver.com/" },
  );
  assert.equal(parsed?.headword, "cost");
  assert.deepEqual(parsed?.senses, [
    { partOfSpeech: "명사", meaning: "비용" },
    { partOfSpeech: "명사", meaning: "경비" },
    { partOfSpeech: "동사", meaning: "들다" },
  ]);
  assert.deepEqual(parsed?.pronunciations, ["kɔːst", "kɒst"]);
});

test("dictionary lookup normalizes PDF whitespace and soft hyphens", () => {
  assert.equal(
    buildDictionaryLookup("  infor\u00admation\n\t retrieval\u00a0")?.term,
    "information retrieval",
  );
});

test("dictionary lookup encodes Korean and URL metacharacters as query text", () => {
  for (const term of [
    "검색",
    "R&D",
    "C++",
    "what? #/main&query=other",
    "O'Brien",
  ]) {
    const lookup = buildDictionaryLookup(term);
    assert.ok(lookup);
    const url = new URL(lookup.url);
    assert.equal(url.origin, "https://en.dict.naver.com");
    const query = new URLSearchParams(url.hash.split("?")[1]);
    assert.deepEqual([...query], [["query", term]]);
  }
});

test("dictionary lookup rejects empty, non-word, and long selections without truncation", () => {
  for (const text of [
    undefined,
    " \n\t ",
    "—...",
    "a".repeat(81),
    "one two three four five six seven eight nine",
    "broken\ud800",
  ]) {
    assert.equal(buildDictionaryLookup(text), undefined);
  }
  assert.equal(buildDictionaryLookup("a".repeat(80))?.term.length, 80);
  assert.ok(buildDictionaryLookup("one two three four five six seven eight"));
});
