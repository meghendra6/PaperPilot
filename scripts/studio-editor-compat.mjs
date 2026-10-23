/** SuperDoc 1.47.2 imports endnotes but omits their export router entry. */
export function patchStudioEditor(source) {
  const router = /footnoteReference:\s*([\w$]+),\s*shapeContainer:/g;
  if ([...source.matchAll(router)].length !== 1)
    throw new Error(
      "SuperDoc export router changed; review the endnote compatibility patch.",
    );
  return source.replace(
    router,
    'footnoteReference:$1,endnoteReference:({node})=>({name:"w:endnoteReference",attributes:{"w:id":String(node.attrs.id),...(node.attrs.customMarkFollows?{"w:customMarkFollows":"1"}:{})}}),shapeContainer:',
  );
}
