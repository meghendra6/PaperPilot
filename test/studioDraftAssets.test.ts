import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  figureMarkup,
  draftTable,
  tableMarkup,
  docxTable,
  relativeAssetPath,
} from "../src/modules/studio/draftAssets";
import { templateDestination } from "../src/modules/studio/documentTemplates";

test("draft assets resolve relative paths without turning filenames into markup", () => {
  assert.equal(
    relativeAssetPath("drafts/article.md", "figures/plot.png"),
    "../figures/plot.png",
  );
  assert.match(figureMarkup("drafts/paper.typ", 'figures/a"b.png'), /a\\"b/);
  assert.throws(
    () => figureMarkup("paper.tex", "figures/{unsafe}.png"),
    /Rename/,
  );
  assert.match(
    figureMarkup("paper.md", "figures/한 글.png"),
    /%ED%95%9C%20%EA%B8%80/,
  );
});

test("tables retain data strings and use literal DOCX text nodes", () => {
  const rows = draftTable("values.csv", 'id,result\n001,"a & b | <tag>"\n');
  assert.equal(rows[1][0], "001");
  assert.equal(
    docxTable(rows).content[1].content[1].content[0].content[0].text,
    "a & b | <tag>",
  );
  assert.match(tableMarkup("paper.tex", rows), /a \\& b/);
  assert.match(tableMarkup("paper.md", rows), /\\\| &lt;tag&gt;/);
  assert.throws(
    () =>
      draftTable(
        "large.csv",
        Array.from({ length: 21 }, (_, i) => `c${i}`).join(","),
      ),
    /20 columns/,
  );
});

test("template copies keep the original format and allow project-relative destinations", () => {
  assert.equal(
    templateDestination("", "templates/manuscript.docx"),
    "manuscript.docx",
  );
  assert.equal(
    templateDestination("drafts/submission.DOCX", "templates/manuscript.docx"),
    "drafts/submission.DOCX",
  );
  assert.throws(
    () => templateDestination("draft.md", "manuscript.docx"),
    /does not convert/,
  );
});
