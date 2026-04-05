declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ZoteroPane: _ZoteroTypes.ZoteroPane;
  Zotero_Tabs: typeof Zotero_Tabs;
  window: Window;
  document: Document;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

declare class Localization {}

declare module "katex" {
  interface KatexOptions {
    displayMode?: boolean;
    output?: "html" | "mathml" | "htmlAndMathml";
    throwOnError?: boolean;
    errorColor?: string;
    macros?: Record<string, string>;
    trust?: boolean;
    strict?: boolean | string;
  }
  function renderToString(tex: string, options?: KatexOptions): string;
  export default { renderToString };
  export { renderToString };
}
