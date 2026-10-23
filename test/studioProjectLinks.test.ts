import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  projectLinkTargets,
  rewriteProjectLinks,
} from "../src/modules/studio/projectLinks";
import { figureMarkup } from "../src/modules/studio/draftAssets";

test("moving a draft rebases its local links while renaming a figure updates only literal references", () => {
  const text =
    "[figure](../figures/a%20b.png#panel)\n[external](https://example.org/a.png)\n`[example](../figures/a%20b.png)`\n```md\n[example](../figures/a%20b.png)\n```\n";
  const updated = rewriteProjectLinks(
    text,
    "drafts/paper.md",
    "paper.md",
    "figures/a b.png",
    "results/한글.png",
  );
  assert.match(updated, /\[figure\]\(results\/%ED%95%9C%EA%B8%80.png#panel\)/);
  assert.match(updated, /`\[example\]\(\.\.\/figures\/a%20b.png\)`/);
  assert.match(updated, /https:\/\/example.org\/a.png/);
  assert.deepEqual(projectLinkTargets("paper.md", updated), [
    "results/한글.png",
  ]);
});

test("generated Markdown, TeX and Typst figure references all survive image renames", () => {
  for (const name of ["draft.md", "draft.tex", "draft.typ"]) {
    const text = figureMarkup(name, "figures/plot.png");
    const updated = rewriteProjectLinks(
      text,
      name,
      name,
      "figures/plot.png",
      "results/new.png",
    );
    assert.deepEqual(projectLinkTargets(name, updated), ["results/new.png"]);
    assert(!updated.includes("figures/plot.png"));
  }
  assert.throws(
    () =>
      rewriteProjectLinks(
        figureMarkup("paper.tex", "plot.png"),
        "paper.tex",
        "paper.tex",
        "plot.png",
        "bad%name.png",
      ),
    /TeX/,
  );
});

test("reference definitions and traversal boundaries remain explicit", () => {
  const text =
    "[ref]: <../data/table.csv>\n[link](../../../outside)\n[file](file:///secret)\n[anchor](#intro)";
  assert.deepEqual(projectLinkTargets("draft/paper.md", text), [
    "data/table.csv",
  ]);
  assert.equal(
    rewriteProjectLinks(
      text,
      "draft/paper.md",
      "draft/paper.md",
      "data/table.csv",
      "new.csv",
    ),
    text.replace("../data/table.csv", "../new.csv"),
  );
});
