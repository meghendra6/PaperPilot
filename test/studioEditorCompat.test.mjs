import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { URL } from "node:url";
import { patchStudioEditor } from "../scripts/studio-editor-compat.mjs";

test("the pinned editor export patch preserves an endnote reference and custom mark", async () => {
  const directory = new URL(
    "../packages/studio-editor/node_modules/superdoc/dist/chunks/",
    import.meta.url,
  );
  const converter = (await readdir(directory)).find((name) =>
    /^SuperConverter-.*\.es\.js$/.test(name),
  );
  assert.ok(converter);
  assert.match(
    patchStudioEditor(await readFile(new URL(converter, directory), "utf8")),
    /endnoteReference:\(\{node\}\)/,
  );
  const source = await readFile(
    new URL(
      "../packages/studio-editor/node_modules/superdoc/dist/superdoc.min.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(patchStudioEditor(source), /endnoteReference:\(\{node\}\)/);
  assert.throws(
    () => patchStudioEditor(patchStudioEditor(source)),
    /router changed/,
  );
  const router = Function(
    `return ({${patchStudioEditor("footnoteReference:null,shapeContainer:null")}})`,
  )();
  assert.deepEqual(
    router.endnoteReference({
      node: { attrs: { id: "7", customMarkFollows: true } },
    }),
    {
      name: "w:endnoteReference",
      attributes: { "w:id": "7", "w:customMarkFollows": "1" },
    },
  );
  assert.deepEqual(router.endnoteReference({ node: { attrs: { id: 2 } } }), {
    name: "w:endnoteReference",
    attributes: { "w:id": "2" },
  });
});
