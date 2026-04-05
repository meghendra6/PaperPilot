export async function savePromptPreviewToNote(params: {
  parentItem: Zotero.Item;
  promptPreview: string;
  modeLabel: string;
}) {
  const note = new Zotero.Item("note");
  note.libraryID = params.parentItem.libraryID;
  note.parentID = params.parentItem.id;
  note.setNote(
    [
      "<h1>AI Reader Prompt Preview</h1>",
      `<p><strong>Mode:</strong> ${params.modeLabel}</p>`,
      "<pre>",
      escapeHtml(params.promptPreview),
      "</pre>",
    ].join(""),
  );
  await note.saveTx();
  return note;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
