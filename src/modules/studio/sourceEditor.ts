import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { r } from "@codemirror/legacy-modes/mode/r";
import { marked } from "marked";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- DOMPurify uses export= with this repository’s CommonJS type settings.
import DOMPurify = require("dompurify");
import { node, type TextSurface } from "./dom";

/** Preview never runs document HTML, loads remote images, or navigates the frame. */
export function renderMarkdown(target: HTMLElement, text: string) {
  target.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "iframe",
      "video",
      "audio",
      "object",
    ],
    FORBID_ATTR: ["style", "srcset", "src", "id", "name"],
  });
  for (const link of target.querySelectorAll("a")) {
    (link as HTMLAnchorElement)?.removeAttribute("href");
  }
}

export function sourceEditor(
  host: HTMLElement,
  name: string,
  source: string,
  readOnly: boolean,
  changed: () => void,
): TextSurface {
  const shell = node("div", undefined, "source-surface");
  const code = node("div", undefined, "source-code");
  const preview = node("article", undefined, "markdown-preview");
  preview.hidden = true;
  const isMarkdown = /\.(md|markdown|myst)$/i.test(name);
  const controls = node("div", undefined, "surface-controls");
  if (isMarkdown) {
    const toggle = node("button", "Preview");
    toggle.addEventListener("click", () => {
      preview.hidden = !preview.hidden;
      shell.classList.toggle("with-preview", !preview.hidden);
      toggle.textContent = preview.hidden ? "Preview" : "Hide preview";
      if (!preview.hidden) renderMarkdown(preview, view.state.doc.toString());
    });
    controls.append(toggle);
  }
  shell.append(controls, code, preview);
  host.append(shell);
  const language = isMarkdown
    ? markdown()
    : /\.py$/i.test(name)
      ? python()
      : /\.(json|ipynb|kanban)$/i.test(name)
        ? json()
        : /\.tex$/i.test(name)
          ? StreamLanguage.define(stex)
          : /\.r$/i.test(name)
            ? StreamLanguage.define(r)
            : [];
  const view = new EditorView({
    parent: code,
    state: EditorState.create({
      doc: source,
      extensions: [
        basicSetup,
        language,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ "aria-label": "Document source" }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (!preview.hidden)
            renderMarkdown(preview, update.state.doc.toString());
          changed();
        }),
      ],
    }),
  });
  return {
    text: () => view.state.doc.toString(),
    selectedText: () =>
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    insert: (text) => {
      if (readOnly) throw new Error("This document is archived.");
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}
