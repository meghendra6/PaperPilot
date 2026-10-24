# Academic drafting in DOCX

1. Create a DOCX, import a journal template, or create a document from a saved
   custom template. Open it in Research Studio.
2. Open **Assistant → Draft paper**. Use **Context → Add files** to select
   relevant PDF/text sources together with the target DOCX. Include source metadata and
   your actual methods/results in the selected files. The project assistant uses
   these captured files; it does not independently search the literature.
3. Add the topic, article type, length and journal requirements. Manuscript text
   defaults to academic English even when your request or sources are Korean;
   assistant explanations follow your conversation language. Another manuscript
   language requires an explicit request. Choose
   your connected Codex CLI, Claude Code or compatible local model and Send.
   Original research defaults to IMRaD; reviews and protocols can request a
   different structure. Local endpoints must support JSON Schema responses.
4. Expand the draft proposal, review every claim and edit the proposed text if
   needed. Use `# Title`, `## Section`, `### Subsection`, and plain paragraphs
   separated by blank lines. **Apply change** appends the draft and saves a new
   version. It preserves existing content; use exact paragraph replacements for
   revisions to existing prose. Use a new DOCX for a fresh complete manuscript.
5. Add figures, tables, equations and live citation fields with Studio's document
   and References tools. Check missing-evidence placeholders and resolve them
   against real sources. Export and inspect the document in Word before delivery.

The draft uses the DOCX's Title, Heading1, Heading2 and Normal styles, preserving
existing style definitions instead of imposing a font or journal layout. A
journal template using other custom style names may need style mapping in Word.
Generated bibliography text is not a verified citation or an automatically
refreshable field. The model is instructed to mark missing support and never
invent data, methods, results, authors or bibliographic records; researchers must
still verify the output. Drafts are limited to 100,000 characters and 500
paragraphs per proposal. They do not contain raw HTML, tables, images, code,
inline Markdown or equation markup.

Example instructions:

> Write an English study protocol about how explicit evidence-gap labels affect
> readers' judgments. Use title, abstract, introduction, proposed methods,
> anticipated limitations and references. No experiment has been conducted and
> no bibliography has been supplied. Mark missing support explicitly; do not
> report hypothetical findings as observed results.
