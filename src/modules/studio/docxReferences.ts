import type { Editor } from "@paperpilot/studio-editor";
import {
  formatDocumentReferences,
  validateReferences,
  type StudioReference,
} from "./references";

type SourceInput = Parameters<
  Editor["doc"]["citations"]["sources"]["insert"]
>[0];
type Source = ReturnType<
  Editor["doc"]["citations"]["sources"]["list"]
>["items"][number];

const sourceTypes: Record<string, SourceInput["type"]> = {
  book: "book",
  "article-journal": "journalArticle",
  "paper-conference": "conferenceProceedings",
  report: "report",
  webpage: "website",
  thesis: "thesis",
  patent: "patent",
};
const fieldNames = {
  title: "title",
  publisher: "publisher",
  "publisher-place": "city",
  "container-title": "journalName",
  volume: "volume",
  issue: "issue",
  page: "pages",
  URL: "url",
  DOI: "doi",
  edition: "edition",
  ISBN: "standardNumber",
} as const;

export function wordSource(record: StudioReference): SourceInput {
  validateReferences([record]);
  const fields: SourceInput["fields"] = {};
  for (const [csl, word] of Object.entries(fieldNames)) {
    const value = (record as unknown as Record<string, unknown>)[csl];
    if (typeof value === "string" || typeof value === "number")
      fields[word] = String(value);
  }
  if (record.author?.length)
    fields.authors = record.author.map((person) => ({
      last: person.literal || person.family || person.given || "",
      ...(person.family && person.given ? { first: person.given } : {}),
    }));
  const year = record.issued?.["date-parts"]?.[0]?.[0];
  if (year !== undefined) fields.year = String(year);
  return { type: sourceTypes[record.type] ?? "misc", fields };
}

export function cslSource(
  source: Pick<Source, "sourceId" | "type" | "fields">,
  id = "word-source",
): StudioReference {
  const record: Record<string, unknown> = {
    id,
    type:
      Object.entries(sourceTypes).find(
        ([, type]) => type === source.type,
      )?.[0] ?? "report",
    title: source.fields.title || "Untitled source",
  };
  for (const [csl, word] of Object.entries(fieldNames))
    if (source.fields[word]) record[csl] = source.fields[word];
  if (source.fields.authors?.length)
    record.author = source.fields.authors.map((person) => ({
      family: person.last,
      ...(person.first ? { given: person.first } : {}),
    }));
  if (source.fields.year && /^\d{4}$/.test(source.fields.year))
    record.issued = { "date-parts": [[Number(source.fields.year)]] };
  return validateReferences([record])[0];
}

function requireSuccess(result: {
  success: boolean;
  failure?: { message: string };
}) {
  if (!result.success)
    throw new Error(
      result.failure?.message ||
        "The document rejected this citation operation.",
    );
}

export async function insertWordCitation(
  editor: Editor,
  records: StudioReference[],
) {
  if (!records.length || records.length > 30)
    throw new Error("Select between 1 and 30 references for a citation field.");
  const inputs = records.map(wordSource);
  const selection = editor.state.selection;
  const position = selection.$from;
  let depth = position.depth;
  while (depth > 0 && position.node(depth).type.name !== "paragraph") depth--;
  const block = position.node(depth);
  const blockId = block.attrs.paraId ?? block.attrs.sdBlockId;
  if (!selection.empty || !block.isTextblock || typeof blockId !== "string")
    throw new Error(
      "Place the cursor in a document paragraph before inserting a Word citation.",
    );
  const offset = block.textBetween(
    0,
    position.pos - position.start(depth),
    "",
    "\ufffc",
  ).length;
  const at = {
    kind: "text" as const,
    segments: [
      {
        blockId,
        range: { start: offset, end: offset },
      },
    ] as [{ blockId: string; range: { start: number; end: number } }],
  };
  const api = editor.doc.citations;
  if (api.list().total >= 500)
    throw new Error("A draft supports up to 500 citation fields.");
  const sourceIds: string[] = [];
  for (const input of inputs) {
    const prior = api.sources
      .list()
      .items.find(
        (source) =>
          JSON.stringify(wordSource(cslSource(source))) ===
          JSON.stringify(input),
      );
    if (prior) {
      sourceIds.push(prior.sourceId);
      continue;
    }
    // SuperDoc 1.x allocates source IDs with Date.now(); separate insertions by a tick.
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const result = api.sources.insert(input);
    requireSuccess(result);
    if (result.success) sourceIds.push(result.source.sourceId);
  }
  requireSuccess(api.insert({ at, sourceIds }));
}

/** Refresh is explicit, including after moving/removing fields or changing style. */
export function refreshWordReferences(
  editor: Editor,
  style: string,
  styleXML?: string,
  addBibliography = false,
) {
  const api = editor.doc.citations;
  const wordSources = api.sources.list().items;
  // Word tags need not obey BibTeX key syntax. Use local CSL identifiers without changing the OOXML tags.
  const ids = new Map(
    wordSources.map((source, index) => [source.sourceId, `word-${index}`]),
  );
  const sources = wordSources.map((source, index) =>
    cslSource(source, `word-${index}`),
  );
  const clusters = api
    .list()
    .items.map((citation) =>
      citation.sourceIds.map((id) => ids.get(id) ?? "missing-source"),
    );
  const formatted = formatDocumentReferences(
    sources,
    clusters,
    style,
    styleXML,
  );
  const wordStyle =
    style === "vancouver"
      ? "ISO 690 - Numerical Reference"
      : style === "harvard1"
        ? "Harvard - Anglia"
        : "APA";
  let hasBibliography = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "bibliography") hasBibliography = true;
  });
  if (addBibliography && !hasBibliography)
    requireSuccess(
      api.bibliography.insert({
        at: { kind: "documentEnd" },
        style: wordStyle,
      }),
    );
  const tr = editor.state.tr;
  let index = 0;
  const replacements: Array<{
    pos: number;
    size: number;
    node: ReturnType<Editor["state"]["doc"]["copy"]>;
  }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "citation") {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        resolvedText: formatted.citations[index++],
        fieldResultContent: null,
      });
      return false;
    }
    if (node.type.name === "bibliography") {
      const lines = formatted.bibliography
        .trim()
        .split(/\n+/)
        .map((line) =>
          editor.schema.nodes.paragraph.create(null, editor.schema.text(line)),
        );
      replacements.push({
        pos,
        size: node.nodeSize,
        node: node.type.create({ ...node.attrs, style: wordStyle }, lines),
      });
      return false;
    }
    return true;
  });
  for (const replacement of replacements.reverse())
    tr.replaceWith(
      replacement.pos,
      replacement.pos + replacement.size,
      replacement.node,
    );
  editor.dispatch(tr);
}
