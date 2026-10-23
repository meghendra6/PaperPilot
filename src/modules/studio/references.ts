import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";

import {
  REFERENCE_KEY,
  validateReferences,
  type StudioReference,
} from "./referenceContracts";
export { validateReferences, type StudioReference } from "./referenceContracts";

/** Explicit input types prevent a pasted DOI/URL from becoming a network lookup. */
export function parseReferences(
  name: string,
  source: string,
): StudioReference[] {
  if (source.length > 5_000_000)
    throw new Error("Reference files must be at most 5 million characters.");
  if (
    /\.bib$/i.test(name) &&
    source.trim() &&
    !/@[A-Za-z]+\s*[{(]/.test(source)
  )
    throw new Error("Paste BibTeX entries, not a URL or DOI lookup request.");
  const records = /\.bib$/i.test(name)
    ? new Cite(source, {
        forceType: "@bibtex/text",
        strict: true,
        generateGraph: false,
        maxChainLength: 10,
        target: "@csl/list+object",
      }).data
    : JSON.parse(source);
  return validateReferences(records);
}

export function referencesBibTeX(records: StudioReference[]) {
  validateReferences(records);
  const config = plugins.config.get("@bibtex");
  const previous = config.format.useIdAsLabel;
  const previousASCII = config.format.asciiOnly;
  try {
    config.format.useIdAsLabel = true;
    config.format.asciiOnly = false;
    return new Cite(records).format("bibtex");
  } finally {
    config.format.useIdAsLabel = previous;
    config.format.asciiOnly = previousASCII;
  }
}

export function formatReferences(
  records: StudioReference[],
  ids: string[],
  style: string,
  kind: "citation" | "bibliography",
  styleXML?: string,
) {
  validateReferences(records);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !records.some((record) => record.id === id))
  )
    throw new Error("Select valid references to insert.");
  style = resolveStyle(style, styleXML);
  const cite = new Cite(records.filter((record) => ids.includes(record.id)));
  return kind === "citation"
    ? cite.format("citation", {
        style,
        format: "text",
        lang: "en-US",
        entry: ids,
        citationsPre: [],
        citationsPost: [],
      })
    : cite.format("bibliography", {
        style,
        format: "text",
        lang: "en-US",
        asEntryArray: false,
      });
}

function resolveStyle(style: string, styleXML?: string) {
  if (styleXML) {
    if (styleXML.length > 2_000_000 || !/<style\b/.test(styleXML))
      throw new Error("Invalid CSL style.");
    // Unique content key avoids citeproc's engine cache reusing a changed style.
    let hash = 2166136261;
    for (let i = 0; i < styleXML.length; i++)
      hash = Math.imul(hash ^ styleXML.charCodeAt(i), 16777619);
    style = `studio-${style}-${hash >>> 0}`;
    plugins.config.get("@csl").styles.add(style, styleXML);
  } else if (!["apa", "vancouver", "harvard1"].includes(style))
    throw new Error("Choose a bundled or installed Zotero citation style.");
  return style;
}

/** All clusters participate in numbering and author/year disambiguation. */
export function formatDocumentReferences(
  records: StudioReference[],
  clusters: string[][],
  style: string,
  styleXML?: string,
) {
  validateReferences(records);
  if (!clusters.length || clusters.length > 500)
    throw new Error("A draft must contain between 1 and 500 citation fields.");
  const ids = [...new Set(clusters.flat())];
  if (
    clusters.some((cluster) => !cluster.length) ||
    ids.some((id) => !records.some((record) => record.id === id))
  )
    throw new Error("A citation refers to missing document source metadata.");
  style = resolveStyle(style, styleXML);
  const cite = new Cite(
    ids.map((id) => records.find((record) => record.id === id)!),
  );
  return {
    citations: clusters.map(
      (entry, index) =>
        cite.format("citation", {
          style,
          format: "text",
          lang: "en-US",
          entry,
          citationsPre: clusters.slice(0, index),
          citationsPost: clusters.slice(index + 1),
        }) as string,
    ),
    bibliography: cite.format("bibliography", {
      style,
      format: "text",
      lang: "en-US",
      entry: ids,
    }) as string,
  };
}

export function citationKeys(name: string, ids: string[]) {
  if (!ids.length || ids.some((id) => !REFERENCE_KEY.test(id)))
    throw new Error("Invalid citation keys.");
  if (/\.tex$/i.test(name)) return `\\cite{${ids.join(",")}}`;
  if (/\.typ$/i.test(name)) return ids.map((id) => `@${id}`).join(" ");
  if (/\.(md|markdown|myst)$/i.test(name))
    return `[${ids.map((id) => `@${id}`).join("; ")}]`;
  throw new Error(
    "Citation keys are available in Markdown, MyST, LaTeX and Typst. Use a formatted citation for DOCX.",
  );
}
