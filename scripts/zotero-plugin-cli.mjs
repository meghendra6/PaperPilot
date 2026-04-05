import util from "node:util";
import { syncBuiltinESMExports } from "node:module";

const originalStyleText = util.styleText.bind(util);

util.styleText = (format, text, options) => {
  const normalize = (value) => (value === "grey" ? "gray" : value);

  return originalStyleText(
    Array.isArray(format) ? format.map(normalize) : normalize(format),
    text,
    options,
  );
};

syncBuiltinESMExports();

const { default: cli } = await import(
  "../node_modules/zotero-plugin-scaffold/dist/cli.mjs"
);

cli();
