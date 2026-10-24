import { node } from "./dom";
import type { StudioDocument } from "./contracts";
import {
  DOCUMENT_FORMATS,
  DOCUMENT_FORMAT_GROUPS,
  baseName,
  documentFormat,
  extensionOf,
  newDocumentName,
  templatesForFormat,
  type TemplateChoice,
} from "./documentTemplates";

/**
 * A selectable card. The radio stays the accessible control; the card after
 * it shows the checked and focus states.
 */
function option(
  className: string,
  input: HTMLInputElement,
  label: string,
  description: string,
  badge?: string,
) {
  const item = node("label", undefined, className);
  const card = node("span", undefined, "option-card");
  const text = node("span", undefined, "option-text");
  text.append(node("strong", label), node("span", description));
  card.append(text);
  if (badge) card.append(node("span", badge, "format-badge"));
  item.append(input, card);
  return item;
}

export interface NewDocumentRequest {
  name: string;
  template: TemplateChoice;
}

/**
 * Chooses a format, a starting template for that format, and a file name.
 * The preview line always shows the exact file that Create makes.
 */
export function newDocumentDialog(actions: {
  documents(): StudioDocument[];
  /** Creates and opens the document. Resolves false when nothing was made. */
  create(request: NewDocumentRequest): Promise<boolean>;
}) {
  const dialog = node("dialog", undefined, "file-dialog new-document");
  dialog.setAttribute("aria-labelledby", "new-document-title");
  // The sandboxed frame blocks form submission, so Create and Enter run the
  // same handler directly.
  const form = node("div", undefined, "dialog-body");
  const heading = node("h2", "New document");
  heading.id = "new-document-title";
  const intro = node(
    "p",
    "Choose a format and where to start. You can rename or move the file later.",
    "dialog-hint",
  );

  const formats = node("fieldset", undefined, "format-list");
  formats.append(node("legend", "Format"));
  const formatInputs = new Map<string, HTMLInputElement>();
  for (const group of DOCUMENT_FORMAT_GROUPS) {
    formats.append(node("p", group.label, "format-group"));
    for (const format of DOCUMENT_FORMATS.filter(
      (entry) => entry.group === group.id,
    )) {
      const input = node("input", undefined, "visually-hidden");
      input.type = "radio";
      input.name = "new-document-format";
      input.value = format.extension;
      input.addEventListener("change", () => chooseFormat(format.extension));
      formatInputs.set(format.extension, input);
      formats.append(
        option(
          "format-option",
          input,
          format.label,
          format.description,
          format.extension.toUpperCase(),
        ),
      );
    }
  }

  const templates = node("fieldset", undefined, "template-list");
  const templateLegend = node("legend", "Start from");
  const templateOptions = node("div", undefined, "template-options");
  templates.append(templateLegend, templateOptions);

  const nameLabel = node("label", undefined, "name-field");
  const name = node("input");
  name.autocomplete = "off";
  name.spellcheck = false;
  nameLabel.append(node("span", "File name"), name);
  // Described by, not live: a live region would speak on every keystroke.
  const preview = node("p", undefined, "name-preview");
  preview.id = "new-document-name-preview";
  name.setAttribute("aria-describedby", preview.id);
  const error = node("p", undefined, "dialog-error");
  error.setAttribute("role", "alert");

  const details = node("div", undefined, "new-document-details");
  details.append(templates, nameLabel, preview, error);
  const columns = node("div", undefined, "new-document-columns");
  columns.append(formats, details);

  const cancel = node("button", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const create = node("button", "Create", "primary");
  create.type = "button";
  const footer = node("div", undefined, "dialog-actions");
  footer.append(cancel, create);
  form.append(heading, intro, columns, footer);
  dialog.append(form);

  let format = "docx";
  let choices: TemplateChoice[] = [];
  let template: TemplateChoice | undefined;
  let creating = false;

  const fallbackBase = () =>
    template?.kind === "builtin"
      ? baseName(template.template.name)
      : template?.kind === "document"
        ? baseName(template.name)
        : "draft";
  const existingNames = () => actions.documents().map((doc) => doc.name);
  const resolve = () =>
    newDocumentName(name.value, format, fallbackBase(), existingNames());

  const updatePreview = () => {
    name.placeholder = `${fallbackBase()}.${format}`;
    try {
      const resolved = resolve();
      preview.replaceChildren(
        node("span", "Creates "),
        node("strong", resolved),
        node("span", " · use / to place it in a folder"),
      );
      delete preview.dataset.error;
    } catch (cause) {
      preview.textContent =
        cause instanceof Error ? cause.message : String(cause);
      preview.dataset.error = "true";
    }
  };
  const renderTemplates = (keep?: string) => {
    choices = templatesForFormat(format, actions.documents());
    template = choices.find((choice) => choice.id === keep) ?? choices[0];
    templateLegend.textContent = `Start from · ${documentFormat(format)?.label ?? format}`;
    templateOptions.replaceChildren();
    for (const choice of choices) {
      const input = node("input", undefined, "visually-hidden");
      input.type = "radio";
      input.name = "new-document-template";
      input.value = choice.id;
      input.checked = choice === template;
      input.addEventListener("change", () => {
        template = choice;
        updatePreview();
      });
      templateOptions.append(
        option(
          "template-option",
          input,
          choice.label,
          choice.description,
          choice.kind === "document" ? "Yours" : undefined,
        ),
      );
    }
    updatePreview();
  };
  function chooseFormat(next: string) {
    if (!documentFormat(next)) return;
    // A typed extension of the previous format no longer applies.
    const typed = name.value.trim();
    if (typed && extensionOf(typed) === format && next !== format)
      name.value = typed.replace(/\.[^./]+$/, "");
    format = next;
    for (const [extension, input] of formatInputs)
      input.checked = extension === format;
    error.textContent = "";
    renderTemplates();
  }
  name.addEventListener("input", () => {
    error.textContent = "";
    // Typing a known extension selects that format, so the preview, the
    // template list and the created file agree.
    const typed = extensionOf(name.value.trim());
    if (typed && typed !== format && documentFormat(typed)) {
      format = typed;
      for (const [extension, input] of formatInputs)
        input.checked = extension === format;
      renderTemplates();
      return;
    }
    updatePreview();
  });

  // Only the name field submits: Enter on a focused format must not create
  // an unnamed file.
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  create.addEventListener("click", () => submit());
  function submit() {
    if (creating || !template) return;
    const chosen = template;
    void (async () => {
      error.textContent = "";
      let resolved: string;
      try {
        resolved = resolve();
        if (chosen.kind !== "blank" && extensionOf(resolved) !== format)
          throw new Error(
            "Keep the template's file extension; changing it does not convert the document.",
          );
      } catch (cause) {
        error.textContent =
          cause instanceof Error ? cause.message : String(cause);
        name.focus();
        return;
      }
      creating = true;
      create.disabled = true;
      create.textContent = "Creating…";
      try {
        if (await actions.create({ name: resolved, template: chosen }))
          dialog.close();
        else
          error.textContent =
            "Another document operation is running. Try again when it finishes.";
      } catch (cause) {
        error.textContent =
          cause instanceof Error ? cause.message : String(cause);
      } finally {
        creating = false;
        create.disabled = false;
        create.textContent = "Create";
      }
    })();
  }

  return {
    element: dialog,
    /** Opens with a format chosen; the name and template start fresh. */
    open(extension?: string) {
      if (creating) return;
      name.value = "";
      error.textContent = "";
      format = extension && documentFormat(extension) ? extension : format;
      for (const [key, input] of formatInputs) input.checked = key === format;
      renderTemplates();
      dialog.showModal();
      formatInputs.get(format)?.focus();
    },
  };
}
