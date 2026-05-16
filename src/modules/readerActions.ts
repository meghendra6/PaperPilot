import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  buildReaderActionQuestion,
  type ReaderActionName,
} from "./readerActionPrompt";
import { clearReaderActionDraft, setReaderActionDraft } from "./readerPane";

declare const Zotero: any;

type DraftSource = "selection-popup" | "annotation-menu";

type TextSelectionPopupEvent = {
  doc: Document;
  params: { annotation?: { text?: string } };
  append: (...nodes: Array<Node | string>) => void;
};

type AnnotationContextMenuEvent = {
  params: { ids?: string[] };
  append: (params: { label: string; onCommand: () => void }) => void;
};

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
  const prepared = buildReaderActionQuestion(params.action, params.text);
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

const renderTextSelectionPopup = (event: TextSelectionPopupEvent) => {
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

const createAnnotationContextMenu = (event: AnnotationContextMenuEvent) => {
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
