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

/** SuperDoc 1.47.2 drops the link button label on every selection update. */
export function patchStudioToolbar(source) {
  const link =
    /attributes:\s*\{\s*ariaLabel:\s*"Link dropdown"\s*\}[\s\S]*?\.expand\.value\s*=\s*(?:false|!1)/g;
  const matches = [...source.matchAll(link)];
  if (matches.length !== 1)
    throw new Error("SuperDoc toolbar changed; review the link label patch.");
  const assignment = /\.attributes\.value\s*=\s*\{([^{}]*)\}/g;
  const values = [...matches[0][0].matchAll(assignment)];
  if (
    values.length !== 3 ||
    values.some((value) => value[1].includes("ariaLabel"))
  )
    throw new Error("SuperDoc toolbar changed; review the link label patch.");
  const headless =
    /([\w$]+)\.attributes\.value\s*=\s*([\w$]+)\?\.value\s*\?\s*\{\s*href:\s*\2\.value\s*\}\s*:\s*\{\}/g;
  if ([...source.matchAll(headless)].length !== 1)
    throw new Error("SuperDoc toolbar changed; review the link state patch.");
  return source
    .replace(
      headless,
      '$1.attributes.value=$2?.value?{ariaLabel:"Link dropdown",href:$2.value}:{ariaLabel:"Link dropdown"}',
    )
    .replace(link, (block) =>
      block.replace(
        assignment,
        '.attributes.value = {ariaLabel:"Link dropdown",$1}',
      ),
    );
}
