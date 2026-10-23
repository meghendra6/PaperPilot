/**
 * bootstrap.js runs the bundle with its `ctx` object on the scope chain and
 * exposes that object as `_globalThis`. `rootURI` and `ztoolkit` live there,
 * not on the sandbox global, so reading them through `globalThis` always
 * yields undefined inside Zotero.
 */
function loaderScope(): Record<string, unknown> | undefined {
  return typeof _globalThis !== "undefined" ? _globalThis : undefined;
}

export function getAddonRootURI(): string {
  const rootURI = loaderScope()?.rootURI;
  return typeof rootURI === "string" ? rootURI : "";
}

export function logWithToolkit(...values: unknown[]): void {
  (loaderScope()?.ztoolkit as ZToolkit | undefined)?.log?.(...values);
}
