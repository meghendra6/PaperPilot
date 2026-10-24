import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { URL } from "node:url";
import {
  patchStudioEditor,
  patchStudioToolbar,
} from "../scripts/studio-editor-compat.mjs";

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

test("the pinned link toolbar retains its accessible name across selection changes", async () => {
  const directory = new URL(
    "../packages/studio-editor/node_modules/superdoc/dist/chunks/",
    import.meta.url,
  );
  let source;
  for (const name of await readdir(directory)) {
    if (!/^src-.*\.es\.js$/.test(name)) continue;
    const candidate = await readFile(new URL(name, directory), "utf8");
    if (candidate.includes('ariaLabel: "Link dropdown"')) source = candidate;
  }
  assert.ok(source);
  const patched = patchStudioToolbar(source);
  assert.throws(() => patchStudioToolbar(patched), /toolbar changed/);
  const block = patched.match(
    /const link = useToolbarItem\(\{[\s\S]*?\n\t\}\);/,
  )[0];
  const link = Function(
    "useToolbarItem",
    "toolbarIcons$1",
    "toolbarTexts$1",
    "renderLinkDropdown",
    `${block}; return link;`,
  )(
    (item) => ({
      ...item,
      attributes: { value: item.attributes },
      expand: { value: true },
    }),
    {},
    {},
    () => {},
  );
  link.onActivate({ href: "https://example.org" });
  assert.deepEqual(link.attributes.value, {
    ariaLabel: "Link dropdown",
    href: "https://example.org",
  });
  link.onActivate({});
  assert.deepEqual(link.attributes.value, { ariaLabel: "Link dropdown" });
  link.onDeactivate();
  assert.deepEqual(link.attributes.value, { ariaLabel: "Link dropdown" });
  assert.equal(link.expand.value, false);
  const stateAssignment = patched.match(
    /item\.attributes\.value=commandState[^;]+;/,
  )[0];
  const update = Function("item", "commandState", stateAssignment);
  update(link, { active: true, value: "https://example.org" });
  assert.deepEqual(link.attributes.value, {
    ariaLabel: "Link dropdown",
    href: "https://example.org",
  });
  update(link, { active: false });
  assert.deepEqual(link.attributes.value, { ariaLabel: "Link dropdown" });
  const minified = await readFile(
    new URL("../superdoc.min.js", directory),
    "utf8",
  );
  assert.match(patchStudioToolbar(minified), /ariaLabel:"Link dropdown",href:/);
});
