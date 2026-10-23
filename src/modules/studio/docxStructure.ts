import type { Editor } from "@paperpilot/studio-editor";
import { node } from "./dom";

function refreshCaptionContents(editor: Editor) {
  const captions = editor.doc.captions.list({ limit: 1000 });
  if (captions.total > captions.items.length)
    throw new Error("A caption list supports at most 1,000 captions.");
  const tr = editor.state.tr;
  const replacements: Array<{
    pos: number;
    size: number;
    node: ReturnType<Editor["state"]["doc"]["copy"]>;
  }> = [];
  editor.state.doc.descendants((entry, pos) => {
    if (entry.type.name !== "tableOfContents") return true;
    const label = /\\c\s+"(Figure|Table)"/.exec(
      String(entry.attrs.instruction),
    )?.[1];
    if (!label) return false;
    const lines = captions.items
      .filter((caption) => caption.label === label)
      .map((caption) => {
        let text = caption.text;
        editor.state.doc.descendants((entry) => {
          if (entry.attrs.sdBlockId !== caption.address.nodeId) return true;
          text = "";
          entry.descendants((part) => {
            if (part.isText) text += part.text;
            else if (part.type.name === "sequenceField") {
              text += String(part.attrs.resolvedNumber ?? caption.number);
              return false;
            }
            return true;
          });
          return false;
        });
        return text;
      });
    const paragraphs = (
      lines.length ? lines : [`No ${label.toLowerCase()} captions.`]
    ).map((line) =>
      editor.schema.nodes.paragraph.create(null, editor.schema.text(line)),
    );
    replacements.push({
      pos,
      size: entry.nodeSize,
      node: entry.type.create(entry.attrs, paragraphs),
    });
    return false;
  });
  for (const entry of replacements.reverse())
    tr.replaceWith(entry.pos, entry.pos + entry.size, entry.node);
  if (replacements.length) editor.dispatch(tr);
}

function succeeded(result: {
  success: boolean;
  failure?: { message?: string };
}) {
  if (!result.success)
    throw new Error(
      result.failure?.message || "The document rejected this operation.",
    );
}

/** Local Word structures use real OOXML entities, not formatted placeholder text. */
export function docxStructure(
  editor: () => Editor | undefined,
  changed: () => void,
) {
  const panel = node("details", undefined, "draft-assets");
  const status = node("output");
  status.setAttribute("aria-live", "polite");
  const current = () => {
    const value = editor();
    if (!value) throw new Error("Open an editable DOCX first.");
    return value;
  };
  const action = (
    label: string,
    run: (engine: Editor) => void,
    mutates = true,
  ) => {
    const button = node("button", label);
    button.type = "button";
    button.addEventListener("click", () => {
      try {
        run(current());
        if (mutates) changed();
        refresh();
        status.textContent = mutates
          ? `${label} completed. Save or wait for autosave.`
          : "Note loaded.";
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      }
    });
    return button;
  };
  const notes = node("select");
  notes.setAttribute("aria-label", "Document notes");
  const text = node("textarea");
  text.setAttribute("aria-label", "Note content");
  text.placeholder = "Footnote or endnote text";
  text.maxLength = 10000;
  let entries: ReturnType<Editor["doc"]["footnotes"]["list"]>["items"] = [];
  let contents: ReturnType<Editor["doc"]["toc"]["list"]>["items"] = [];
  const tocChoice = node("select");
  tocChoice.setAttribute("aria-label", "Document contents lists");
  const captionLabel = node("select");
  captionLabel.setAttribute("aria-label", "Caption label");
  for (const label of ["Figure", "Table"])
    captionLabel.append(node("option", label));
  const captionText = node("input");
  captionText.setAttribute("aria-label", "Caption text");
  captionText.maxLength = 2000;
  const refresh = () => {
    const engine = editor();
    const selected = notes.value;
    const selectedToc = tocChoice.value;
    notes.replaceChildren();
    tocChoice.replaceChildren();
    if (!engine) return;
    const noteList = engine.doc.footnotes.list({ limit: 500 });
    const tocList = engine.doc.toc.list({ limit: 100 });
    entries = noteList.items;
    contents = tocList.items;
    for (const note of entries) {
      const option = node(
        "option",
        `${note.type} ${note.displayNumber}: ${note.content.slice(0, 70)}`,
      );
      option.value = `${note.type}:${note.noteId}`;
      notes.append(option);
    }
    for (const toc of contents) {
      const option = node("option", toc.instruction);
      option.value = toc.address.nodeId;
      tocChoice.append(option);
    }
    if (entries.some((note) => `${note.type}:${note.noteId}` === selected))
      notes.value = selected;
    if (contents.some((toc) => toc.address.nodeId === selectedToc))
      tocChoice.value = selectedToc;
    if (noteList.total > entries.length || tocList.total > contents.length)
      status.textContent =
        "Showing the first 500 notes and 100 contents lists.";
  };
  const selectedNote = () => {
    const selected = entries.find(
      (note) => `${note.type}:${note.noteId}` === notes.value,
    );
    if (!selected) throw new Error("Choose a note first.");
    return selected;
  };
  notes.addEventListener("change", () => {
    text.value = selectedNote().content;
  });
  const insertNote = (engine: Editor, type: "footnote" | "endnote") => {
    if (!text.value.trim()) throw new Error("Enter note content first.");
    if (!engine.state.selection.empty)
      throw new Error(
        "Place the cursor in a paragraph before inserting a note.",
      );
    succeeded(engine.doc.footnotes.insert({ type, content: text.value }));
  };
  panel.append(
    node("summary", "Notes & contents"),
    node(
      "p",
      "Place the cursor in the draft to add a note. Heading styles supply the table of contents. Refresh lists after editing; verify final pagination and fields in Word.",
      "surface-notice",
    ),
    text,
    action("Insert footnote", (engine) => insertNote(engine, "footnote")),
    action("Insert endnote", (engine) => insertNote(engine, "endnote")),
    notes,
    action(
      "Load selected note",
      () => {
        text.value = selectedNote().content;
      },
      false,
    ),
    action("Update selected note", (engine) => {
      // OOXML permits footnote 1 and endnote 1 simultaneously. The engine's
      // footnotes.update target omits the note type; use an explicit story.
      const note = selectedNote();
      const story = {
        kind: "story" as const,
        storyType: note.type,
        noteId: note.noteId,
      };
      if (!note.content) {
        succeeded(engine.doc.insert({ in: story, value: text.value }));
        return;
      }
      const matches = engine.doc.query.match({
        in: story,
        select: { type: "text", pattern: note.content, caseSensitive: true },
        limit: 2,
      });
      const match = matches.items[0];
      if (matches.total !== 1 || match?.matchKind !== "text")
        throw new Error(
          "This note's text could not be matched uniquely. Its content was preserved.",
        );
      succeeded(
        engine.doc.replace({
          in: story,
          target: match.target,
          text: text.value,
        }),
      );
    }),
    action("Remove selected note", (engine) => {
      const note = selectedNote();
      const positions: Array<{ pos: number; size: number }> = [];
      engine.state.doc.descendants((node, pos) => {
        if (
          node.type.name === `${note.type}Reference` &&
          String(node.attrs.id) === note.noteId
        )
          positions.push({ pos, size: node.nodeSize });
      });
      if (!positions.length)
        throw new Error("The selected note reference no longer exists.");
      const tr = engine.state.tr;
      for (const entry of positions.reverse())
        tr.delete(entry.pos, entry.pos + entry.size);
      engine.dispatch(tr);
    }),
    action("Insert table of contents", (engine) => {
      succeeded(
        engine.doc.create.tableOfContents({
          at: { kind: "documentStart" },
          config: {
            outlineLevels: { from: 1, to: 3 },
            hyperlinks: true,
            includePageNumbers: true,
          },
        }),
      );
    }),
    captionLabel,
    captionText,
    action("Insert caption below paragraph", (engine) => {
      const position = engine.state.selection.$from;
      let depth = position.depth;
      while (depth > 0 && position.node(depth).type.name !== "paragraph")
        depth--;
      const paragraph = position.node(depth);
      const id = paragraph.attrs.paraId ?? paragraph.attrs.sdBlockId;
      if (paragraph.type.name !== "paragraph" || typeof id !== "string")
        throw new Error(
          "Place the cursor in the paragraph containing the figure or table.",
        );
      succeeded(
        engine.doc.captions.insert({
          adjacentTo: { kind: "block", nodeType: "paragraph", nodeId: id },
          position: "below",
          label: captionLabel.value,
          text: captionText.value,
        }),
      );
    }),
    action("Insert caption list", (engine) => {
      // SuperDoc 1.47's create API accepts but ignores raw instructions. Keep
      // the caption switch in the actual field node before materializing it.
      const field = engine.schema.nodes.tableOfContents.create(
        {
          instruction: `TOC \\c "${captionLabel.value}" \\h \\n "1-9"`,
          sdBlockId: crypto.randomUUID(),
        },
        engine.schema.nodes.paragraph.create(),
      );
      engine.dispatch(
        engine.state.tr.insert(engine.state.doc.content.size, field),
      );
      refreshCaptionContents(engine);
    }),
    node(
      "p",
      "Caption lists keep Word TOC/SEQ fields and refresh their text locally. Caption-list page numbers are omitted.",
      "surface-notice",
    ),
    tocChoice,
    action("Refresh selected contents", (engine) => {
      const toc = contents.find(
        (entry) => entry.address.nodeId === tocChoice.value,
      );
      if (!toc) throw new Error("Choose a contents list first.");
      if (
        toc.preserved.seqFieldIdentifier === "Figure" ||
        toc.preserved.seqFieldIdentifier === "Table"
      )
        refreshCaptionContents(engine);
      else
        succeeded(engine.doc.toc.update({ target: toc.address, mode: "all" }));
    }),
    action("Remove selected contents", (engine) => {
      const toc = contents.find(
        (entry) => entry.address.nodeId === tocChoice.value,
      );
      if (!toc) throw new Error("Choose a contents list first.");
      succeeded(engine.doc.toc.remove({ target: toc.address }));
    }),
    status,
  );
  panel.addEventListener("toggle", () => {
    if (panel.open) {
      try {
        refresh();
      } catch (error) {
        status.textContent = String(error);
      }
    }
  });
  return { element: panel, refresh };
}
