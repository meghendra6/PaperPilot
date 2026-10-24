/** Manuscript language is independent of the conversation and evidence language. */
export const ACADEMIC_LANGUAGE_POLICY =
  "Write academic manuscript content in formal academic English by default, including titles, abstracts, keywords, section headings, body paragraphs and newly written captions. The language of the request or source documents must not change the manuscript language. Use another manuscript language only when the user explicitly requests it. Keep reply and change reasons in the user's language. Preserve exact quotations, author names and original bibliographic metadata. Use precise academic prose, consistent terminology and tense, and avoid promotional claims.";

/** Deliberately small authoring format: semantic headings and plain paragraphs. */
export function academicDraft(source: string) {
  if (!source.trim() || source.length > 100_000)
    throw new Error("A paper draft must contain 1–100,000 characters.");
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Array<{ style: string; text: string }> = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ style: "Normal", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (
      Array.from(line).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      /^(?:#{4,}\s|```|~~~|>|[-+*]\s|\d+[.)]\s|\|)/.test(line) ||
      /<\/?[a-z][^>]*>|!?\[[^\]]*\]\([^)]*\)|`|\*\*|__/.test(line)
    )
      throw new Error(
        "Paper drafts support plain paragraphs and # title, ## section, ### subsection headings. Add tables, figures, equations and citation fields with the document tools.",
      );
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        style: ["Title", "Heading1", "Heading2"][heading[1].length - 1],
        text: heading[2],
      });
    } else paragraph.push(line);
  }
  flush();
  if (blocks.length > 500)
    throw new Error("A paper draft supports at most 500 paragraphs.");
  return {
    text: blocks.map((block) => block.text).join("\n"),
    content: blocks.map((block) => ({
      type: "paragraph",
      attrs: {
        paragraphProperties: { styleId: block.style },
      },
      content: [{ type: "text", text: block.text }],
    })),
  };
}

export function academicDraftRequest(name: string) {
  return `Draft an academic manuscript in ${JSON.stringify(name)} using the selected evidence and my instructions below. Propose a draft operation for that DOCX; it appends a reviewed draft without replacing existing content. Follow the document's existing terminology and my journal/template requirements. Use IMRaD for an original research paper unless a different article type or structure is requested: title, abstract, keywords, introduction, methods, results, discussion, conclusion, and references. Keep claims proportional to the supplied evidence. Never invent authors, affiliations, methods, sample sizes, statistics, findings, DOIs or bibliographic entries. Distinguish proposed methods from completed work. Use [Evidence needed: ...] and [Citation needed: ...] wherever support is missing. Cite only source metadata supplied in context; explain unresolved references and use the References tools later for live citation fields. ${ACADEMIC_LANGUAGE_POLICY} Write coherent academic paragraphs, not a list of instructions.\n\nManuscript language: English unless I explicitly request another language.\nTopic, article type, journal, length and additional instructions:\n`;
}
