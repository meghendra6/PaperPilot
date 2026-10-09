import { config } from "../../package.json";
import { getString } from "../utils/locale";
import {
  buildReaderActionQuestion,
  type ReaderActionName,
} from "./readerActionPrompt";
import { getModeForItem } from "./ai/modeStore";
import { clearReaderActionDraft, setReaderActionDraft } from "./readerPane";
import { sessionStore } from "./session/sessionStore";
import { ensureSelectionPopupStyles } from "./ui/selectionPopup";
import {
  buildDictionaryButton,
  closeDictionaryPopups,
} from "./ui/dictionaryPopup";
import { isReaderChatBusy } from "./ai/readerBusy";
import { getDiscoveryAvailability } from "./discovery/capabilities";
import { DISCOVERY_ALREADY_RUNNING_MESSAGE } from "./ui/discoveryEntryState";

function isDiscoveryRunning(itemID: number): boolean {
  return Boolean(addon.data.relatedRecommendationStates?.get(itemID)?.running);
}

function isReaderActionBusy(itemID: number): boolean {
  // Discovery holds a workspace reservation. Check its own state as well so a
  // second request cannot reach the pane while that search runs.
  return isReaderChatBusy(itemID) || isDiscoveryRunning(itemID);
}

/** Why a popup action cannot run now, or undefined when it can. */
function getSelectionActionBlockReason(
  itemID: number | undefined,
  action: ReaderActionName,
): string | undefined {
  if (!itemID) return undefined;
  if (action === "find-prior-work") {
    if (isDiscoveryRunning(itemID)) return DISCOVERY_ALREADY_RUNNING_MESSAGE;
    const availability = getDiscoveryAvailability(getModeForItem(itemID));
    if (!availability.available) return availability.reason;
  }
  return isReaderActionBusy(itemID)
    ? "Stop the current response in Paper Pilot first."
    : undefined;
}

export {
  activateReaderCapability,
  type ReaderCapabilityAction,
} from "./readerCapabilityBridge";

declare const Zotero: any;
declare const addon: import("../addon").default;

type DraftSource = "selection-popup" | "annotation-menu";

type TextSelectionPopupEvent = {
  doc: Document;
  reader?: { itemID?: number; _item?: { id?: number; parentItemID?: number } };
  params: {
    annotation?: {
      text?: string;
      pageLabel?: string;
      position?: { pageIndex?: number };
    };
  };
  append: (...nodes: Array<Node | string>) => void;
};

type AnnotationContextMenuEvent = {
  reader?: { itemID?: number; _item?: { id?: number; parentItemID?: number } };
  params: { ids?: string[] };
  append: (params: { label: string; onCommand: () => void }) => void;
};

function ensureReaderActionSession(itemID: number) {
  const item = Zotero.Items?.get?.(itemID);
  const title = String(item?.getField?.("title") || "");
  return sessionStore.getOrCreate(itemID, getModeForItem(itemID), title)
    .sessionId;
}

function saveDraft(
  params: {
    itemID: number;
    source: DraftSource;
    action: string;
    text?: string;
    annotationIDs?: string[];
    attachmentID?: number;
    pageIndex?: number;
    pageLabel?: string;
  },
  attachToComposer = true,
) {
  setReaderActionDraft(
    {
      ...params,
      sessionId: ensureReaderActionSession(params.itemID),
      updatedAt: new Date().toISOString(),
    },
    { attachToComposer },
  );
}

function eventItemID(event: {
  reader?: { itemID?: number; _item?: { id?: number; parentItemID?: number } };
}) {
  return (
    event.reader?._item?.parentItemID ||
    event.reader?._item?.id ||
    event.reader?.itemID
  );
}

function queueReaderAction(
  itemID: number,
  question: string,
  autoSubmit: boolean,
) {
  addon.data.pendingReaderActions?.set(itemID, {
    sessionId: ensureReaderActionSession(itemID),
    question,
    autoSubmit,
    updatedAt: new Date().toISOString(),
  });
  void addon.data.applyReaderActionToPane?.get(itemID)?.();
}

function triggerAction(params: {
  source: DraftSource;
  action: ReaderActionName;
  text?: string;
  annotationIDs?: string[];
  attachmentID?: number;
  pageIndex?: number;
  pageLabel?: string;
  itemID?: number;
}) {
  if (!params.itemID || (!params.text && !params.annotationIDs?.length)) {
    if (params.itemID) clearReaderActionDraft(params.itemID);
    return;
  }

  if (getSelectionActionBlockReason(params.itemID, params.action)) return;

  if (params.action === "find-prior-work" && params.text) {
    addon.data.pendingDiscoveryConcerns?.set(params.itemID, {
      sessionId: ensureReaderActionSession(params.itemID),
      text: params.text,
      origin: "selection",
      updatedAt: new Date().toISOString(),
    });
    void addon.data.applyReaderActionToPane?.get(params.itemID)?.();
    return;
  }

  const prepared = buildReaderActionQuestion(params.action, params.text);
  saveDraft({ ...params, itemID: params.itemID }, !prepared.autoSubmit);
  queueReaderAction(params.itemID, prepared.question, prepared.autoSubmit);
}

function buildSelectionActionButton(params: {
  doc: Document;
  label: string;
  action: ReaderActionName;
  text?: string;
  attachmentID?: number;
  pageIndex?: number;
  pageLabel?: string;
  itemID?: number;
}) {
  const button = params.doc.createElement("button");
  button.type = "button";
  button.textContent = params.label;
  button.className = "pp-btn pp-btn--secondary pp-selection-action";
  const blockReason = getSelectionActionBlockReason(
    params.itemID,
    params.action,
  );
  button.disabled = Boolean(blockReason);
  if (blockReason) button.title = blockReason;
  button.addEventListener("click", () => {
    triggerAction({
      source: "selection-popup",
      action: params.action,
      text: params.text,
      itemID: params.itemID,
      attachmentID: params.attachmentID,
      pageIndex: params.pageIndex,
      pageLabel: params.pageLabel,
    });
  });
  return button;
}

const SELECTION_ACTIONS = [
  {
    label: () => getString("reader-action-find-prior-work"),
    action: "find-prior-work",
  },
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
  ensureSelectionPopupStyles(event.doc);
  const wrapper = event.doc.createElement("div");
  wrapper.className = "pp-selection-actions";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", "Paper Pilot");
  const dictionary = buildDictionaryButton(
    event.doc,
    event.params.annotation?.text,
  );
  if (dictionary) wrapper.append(dictionary);
  for (const item of SELECTION_ACTIONS) {
    wrapper.append(
      buildSelectionActionButton({
        doc: event.doc,
        label: item.label(),
        action: item.action,
        text: event.params.annotation?.text,
        itemID: eventItemID(event),
        attachmentID: event.reader?._item?.id ?? event.reader?.itemID,
        pageIndex: event.params.annotation?.position?.pageIndex,
        pageLabel: event.params.annotation?.pageLabel,
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
          itemID: eventItemID(event),
          attachmentID: event.reader?._item?.id ?? event.reader?.itemID,
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
  closeDictionaryPopups();
  Zotero.Reader.unregisterEventListener(
    "renderTextSelectionPopup",
    renderTextSelectionPopup,
  );
  Zotero.Reader.unregisterEventListener(
    "createAnnotationContextMenu",
    createAnnotationContextMenu,
  );
}
