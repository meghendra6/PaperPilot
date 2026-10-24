import * as assert from "node:assert/strict";
import { test } from "node:test";
import { academicDraft } from "../src/modules/studio/academicDraft";
import {
  DOCUMENT_FORMATS,
  DOCUMENT_TEMPLATES,
  NEW_DOCUMENT_EXTENSION,
  baseName,
  extensionOf,
  newDocumentName,
  templatesForFormat,
} from "../src/modules/studio/documentTemplates";

const doc = (id: string, name: string, archived = false) => ({
  id,
  name,
  archived,
});

test("every writing format offers a blank start and at least one built-in template", () => {
  for (const format of DOCUMENT_FORMATS.filter(
    (entry) => entry.group === "write",
  )) {
    const choices = templatesForFormat(format.extension, []);
    assert.equal(choices[0].kind, "blank", format.extension);
    assert.ok(
      choices.some((choice) => choice.kind === "builtin"),
      `${format.extension} has no built-in template`,
    );
  }
});

test("template choices match the selected format only", () => {
  const documents = [
    doc("a", "templates/journal.docx"),
    doc("b", "templates/notes.md"),
    doc("c", "templates/old.docx", true),
    doc("d", "drafts/paper.docx"),
  ];
  const docx = templatesForFormat("docx", documents);
  assert.deepEqual(
    docx.map((choice) => choice.label),
    ["Blank", "Research article", "Literature review", "journal.docx"],
  );
  const own = docx.at(-1);
  assert.equal(own?.kind, "document");
  assert.equal(own?.kind === "document" && own.documentID, "a");
  assert.deepEqual(
    templatesForFormat("md", documents).map((choice) => choice.label),
    ["Blank", "Literature review", "notes.md"],
  );
  assert.deepEqual(
    templatesForFormat("kanban", documents).map((choice) => choice.kind),
    ["blank"],
  );
});

test("built-in templates are valid for their format", () => {
  const ids = new Set<string>();
  for (const template of DOCUMENT_TEMPLATES) {
    assert.ok(!ids.has(template.id), `duplicate id ${template.id}`);
    ids.add(template.id);
    assert.match(template.name, NEW_DOCUMENT_EXTENSION);
    // DOCX outlines become styled paragraphs through the draft parser.
    if (extensionOf(template.name) === "docx")
      assert.ok(academicDraft(template.text).content.length > 3);
  }
});

test("new document names use the format extension and never collide by default", () => {
  assert.equal(newDocumentName("", "docx", "draft", []), "draft.docx");
  assert.equal(
    newDocumentName("", "docx", "article", ["article.docx", "article-2.docx"]),
    "article-3.docx",
  );
  assert.equal(newDocumentName("  ", "md", "", []), "draft.md");
  assert.equal(
    newDocumentName("drafts/paper", "tex", "draft", []),
    "drafts/paper.tex",
  );
  assert.equal(newDocumentName("v1.2", "docx", "draft", []), "v1.2.docx");
  // A typed supported extension is kept: the dialog switches format to match.
  assert.equal(
    newDocumentName("Submission.DOCX", "docx", "draft", []),
    "Submission.DOCX",
  );
  assert.equal(newDocumentName("script.py", "txt", "draft", []), "script.py");
  assert.throws(
    () => newDocumentName("paper", "docx", "draft", ["paper.docx"]),
    /already exists/,
  );
});

test("file name helpers read the last path segment", () => {
  assert.equal(extensionOf("templates/Journal.DOCX"), "docx");
  assert.equal(extensionOf("README"), "");
  assert.equal(extensionOf("folder.v2/README"), "");
  assert.equal(baseName("templates/journal.docx"), "journal");
  assert.equal(baseName("notes"), "notes");
});
