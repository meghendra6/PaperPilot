import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  citationKeys,
  formatReferences,
  parseReferences,
  referencesBibTeX,
  validateReferences,
  formatDocumentReferences,
} from "../src/modules/studio/references";
import { wordSource, cslSource } from "../src/modules/studio/docxReferences";

test("document-wide citations preserve first-appearance numbering and repeated sources", () => {
  const records = parseReferences(
    "r.bib",
    "@article{alpha, title={Alpha study}, author={Adams, Alice}, year={2025}, journal={A}}\n@article{beta, title={Beta study}, author={Brown, Bob}, year={2026}, journal={B}}",
  );
  const result = formatDocumentReferences(
    records,
    [["beta"], ["alpha"], ["beta"]],
    "vancouver",
  );
  assert.deepEqual(result.citations, ["(1)", "(2)", "(1)"]);
  assert(
    result.bibliography.indexOf("Beta study") <
      result.bibliography.indexOf("Alpha study"),
  );
  const reordered = formatDocumentReferences(
    records,
    [["alpha"], ["beta"]],
    "vancouver",
  );
  assert(
    reordered.bibliography.indexOf("Alpha study") <
      reordered.bibliography.indexOf("Beta study"),
  );
  assert.throws(
    () => formatDocumentReferences(records, [["absent"]], "apa"),
    /missing/,
  );
});

test("Word source metadata keeps author, year, Unicode title and DOI through its supported schema", () => {
  const record = parseReferences(
    "r.bib",
    "@article{kim2026, title={한글 study}, author={Kim, Jane}, year={2026}, journal={Test}, volume={12}, pages={01--09}, doi={10.1234/test}}",
  )[0];
  const input = wordSource(record);
  const output = cslSource({ sourceId: "source-123", ...input });
  assert.equal(output.title, record.title);
  assert.deepEqual(output.author, record.author);
  assert.deepEqual(output.issued, record.issued);
  assert.equal(output.DOI, record.DOI);
  assert.equal(output.page, record.page);
});

test("BibTeX parsing and export preserve citation keys and Unicode author/title data", () => {
  const records = parseReferences(
    "references.bib",
    "@article{smith2026, title={Unicode 한글 study}, author={Smith, Jane and Doe, John}, year={2026}, journal={Test Journal}, doi={10.1234/test}}",
  );
  assert.equal(records[0].id, "smith2026");
  assert.equal(records[0].title, "Unicode 한글 study");
  const roundTrip = parseReferences("out.bib", referencesBibTeX(records));
  assert.equal(roundTrip[0].id, "smith2026");
  assert.equal(roundTrip[0].title, records[0].title);
  assert.equal(roundTrip[0].author?.[0].family, "Smith");
});

test("bundled CSL styles produce actual citations and bibliographies without a model", () => {
  const records = parseReferences(
    "references.bib",
    "@article{smith2026, title={Evidence study}, author={Smith, Jane}, year={2026}, journal={Test Journal}}",
  );
  assert.match(
    formatReferences(records, ["smith2026"], "apa", "citation"),
    /Smith.*2026/,
  );
  const bibliography = formatReferences(
    records,
    ["smith2026"],
    "apa",
    "bibliography",
  );
  assert.match(bibliography, /Evidence study/);
  assert.match(bibliography, /Test Journal/);
  assert.match(
    formatReferences(records, ["smith2026"], "vancouver", "citation"),
    /1/,
  );
  assert.throws(() =>
    formatReferences(records, ["missing"], "apa", "citation"),
  );
});

test("reference identities reject duplicates and citation syntax injection", () => {
  assert.throws(() =>
    validateReferences([
      { id: "a", title: "A", type: "book" },
      { id: "a", title: "B", type: "book" },
    ]),
  );
  assert.throws(() => citationKeys("draft.md", ["a] evil"]));
  assert.equal(
    citationKeys("draft.tex", ["smith2026", "jones2025"]),
    "\\cite{smith2026,jones2025}",
  );
  assert.equal(citationKeys("draft.md", ["smith2026"]), "[@smith2026]");
  assert.throws(() =>
    parseReferences("input.bib", "https://example.org/private"),
  );
});
