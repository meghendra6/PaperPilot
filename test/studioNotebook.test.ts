import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  newCell,
  newNotebook,
  notebookText,
  parseNotebook,
} from "../src/modules/studio/notebook";

test("notebook round trips preserve attachments, unknown metadata and future cell/output types", () => {
  const notebook = newNotebook();
  notebook.metadata.custom = { keep: true };
  notebook.cells.push({
    cell_type: "future",
    metadata: { editable: false },
    source: ["one\n", "two"],
    attachments: { picture: { "image/png": "AAAA" } },
    future: { data: 1 },
  });
  const decoded = parseNotebook(JSON.stringify(notebook));
  assert.deepEqual(decoded, notebook);
  assert.equal(notebookText(decoded.cells[0].source), "one\ntwo");
  assert.throws(
    () => parseNotebook(JSON.stringify({ ...notebook, nbformat: 5 })),
    /unsupported/,
  );
  assert.throws(() => notebookText(["text", 5]), /string/);
});

test("new code cells have nbformat execution fields; malformed cells are not normalized destructively", () => {
  const notebook = newNotebook();
  notebook.cells.push(newCell("code", "cell-1"), newCell("markdown", "cell-2"));
  assert.deepEqual(
    parseNotebook(JSON.stringify(notebook)).cells[0].outputs,
    [],
  );
  delete notebook.cells[0].outputs;
  assert.throws(() => parseNotebook(JSON.stringify(notebook)), /code cell/);
});
