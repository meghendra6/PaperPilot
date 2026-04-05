import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { normalizeResponseLanguage } from "./translation/responseLanguage";
import { clearReaderActionDraft, setReaderActionDraft } from "./readerPane";

type DraftSource = "selection-popup" | "annotation-menu";

type ReaderActionName =
  | "explain"
  | "summarize"
  | "translate"
  | "ask-ai"
  | "annotation-ask"
  | "annotation-summarize"
  | "annotation-explain";

function saveDraft(params: {
  source: DraftSource;
  action: string;
  text?: string;
  annotationIDs?: string[];
}) {
  addon.data.readerActionDraft = {
    ...params,
    updatedAt: new Date().toISOString(),
  };
  setReaderActionDraft(addon.data.readerActionDraft);
}

function queueReaderAction(question: string, autoSubmit: boolean) {
  addon.data.pendingReaderAction = {
    question,
    autoSubmit,
    updatedAt: new Date().toISOString(),
  };
  void addon.data.applyReaderActionToPane?.();
}

function buildQuestion(action: ReaderActionName, text?: string) {
  const selected = text
    ? `

Selected text:
${text}`
    : "";
  const targetLanguage = normalizeResponseLanguage(getPref("responseLanguage"));

  switch (action) {
    case "explain":
    case "annotation-explain":
      return {
        question: `Explain the selected passage in the context of this paper.${selected}`,
        autoSubmit: true,
      };
    case "summarize":
    case "annotation-summarize":
      return {
        question: `Summarize the selected passage in the context of this paper.${selected}`,
        autoSubmit: true,
      };
    case "translate":
      return {
        question: `Translate the selected passage into ${targetLanguage}.${selected}`,
        autoSubmit: true,
      };
    case "annotation-ask":
    case "ask-ai":
    default:
      return {
        question: text
          ? `Ask a question about the selected passage.${selected}`
          : "Ask a question about this annotation.",
        autoSubmit: false,
      };
  }
}

function triggerAction(params: {
  source: DraftSource;
  action: ReaderActionName;
  text?: string;
  annotationIDs?: string[];
}) {
  if (!params.text && !params.annotationIDs?.length) {
    clearReaderActionDraft();
    return;
  }

  saveDraft(params);
  const prepared = buildQuestion(params.action, params.text);
  queueReaderAction(prepared.question, prepared.autoSubmit);
}

function buildSelectionActionButton(params: {
  doc: Document;
  label: string;
  action: ReaderActionName;
  text?: string;
}) {
  const button = params.doc.createElement("button");
  button.textContent = params.label;
  button.style.cssText = [
    "padding: 4px 8px",
    "border-radius: 6px",
    "border: 1px solid #d0d0d0",
    "background: #fff",
    "cursor: pointer",
    "font-size: 12px",
  ].join("; ");
  button.addEventListener("click", () => {
    triggerAction({
      source: "selection-popup",
      action: params.action,
      text: params.text,
    });
  });
  return button;
}

const SELECTION_ACTIONS = [
  { label: () => getString("reader-action-explain"), action: "explain" },
  { label: () => getString("reader-action-summarize"), action: "summarize" },
  { label: () => getString("reader-action-translate"), action: "translate" },
  { label: () => getString("reader-action-ask-ai"), action: "ask-ai" },
] as const;

const ANNOTATION_ACTIONS = [
  {
    label: () => getString("reader-action-annotation-ask"),
    action: "annotation-ask",
  },
  {
    label: () => getString("reader-action-annotation-summarize"),
    action: "annotation-summarize",
  },
  {
    label: () => getString("reader-action-annotation-explain"),
    action: "annotation-explain",
  },
] as const;

const renderTextSelectionPopup = (
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) => {
  const wrapper = event.doc.createElement("div");
  wrapper.style.cssText =
    "display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; align-items:center;";
  for (const item of SELECTION_ACTIONS) {
    wrapper.append(
      buildSelectionActionButton({
        doc: event.doc,
        label: item.label(),
        action: item.action,
        text: event.params.annotation?.text,
      }),
    );
  }
  event.append(wrapper);
};

const createAnnotationContextMenu = (
  event: _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">,
) => {
  for (const item of ANNOTATION_ACTIONS) {
    event.append({
      label: item.label(),
      onCommand: () => {
        triggerAction({
          source: "annotation-menu",
          action: item.action,
          annotationIDs: event.params.ids,
        });
      },
    });
  }
};

export function registerReaderActionPlaceholders() {
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    renderTextSelectionPopup,
    config.addonID,
  );
  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    createAnnotationContextMenu,
    config.addonID,
  );
}

export function unregisterReaderActionPlaceholders() {
  Zotero.Reader.unregisterEventListener(
    "renderTextSelectionPopup",
    renderTextSelectionPopup,
  );
  Zotero.Reader.unregisterEventListener(
    "createAnnotationContextMenu",
    createAnnotationContextMenu,
  );
}
