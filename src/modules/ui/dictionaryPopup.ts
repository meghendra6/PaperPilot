import { DialogHelper } from "zotero-plugin-toolkit";
import { getString } from "../../utils/locale";
import {
  buildDictionaryLookup,
  type DictionaryEntry,
  type DictionaryLookup,
} from "../dictionaryLookup";
import { requestDictionary } from "../dictionaryRequest";

const ROOT_ID = "paperpilot-dictionary-window";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const KOREAN_COPY = {
  "reader-action-dictionary": "네이버 사전",
  "dictionary-lookup-hint":
    "선택한 단어의 뜻을 별도 사전 창에서 확인합니다 (인터넷 연결 필요).",
  "dictionary-open-browser": "네이버에서 더 보기",
  "dictionary-loading": "뜻을 찾는 중…",
  "dictionary-empty": "일치하는 단어의 뜻을 찾지 못했습니다.",
  "dictionary-error": "뜻을 불러오지 못했습니다. 다시 시도해 주세요.",
  "dictionary-retry": "다시 시도",
  "dictionary-close": "사전 닫기",
} as const;

export type DictionaryWindowState = {
  dialog: DialogHelper;
  lookup: DictionaryLookup;
  refresh?: () => void;
  dispose: () => void;
};

function dictionaryString(key: keyof typeof KOREAN_COPY) {
  return Zotero.locale.startsWith("ko") ? KOREAN_COPY[key] : getString(key);
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  node.textContent = text;
  node.className = className;
  return node;
}

function renderEntry(doc: Document, entry: DictionaryEntry) {
  const content = element(doc, "div");
  if (entry.pronunciations.length) {
    content.append(
      element(
        doc,
        "p",
        entry.pronunciations.join(" · "),
        "dictionary-phonetic",
      ),
    );
  }
  const list = element(doc, "ol");
  for (const sense of entry.senses) {
    const row = element(doc, "li");
    if (sense.partOfSpeech)
      row.append(element(doc, "span", sense.partOfSpeech, "dictionary-pos"));
    row.append(doc.createTextNode(sense.meaning));
    list.append(row);
  }
  content.append(list, element(doc, "p", entry.source, "dictionary-source"));
  return content;
}

function mountDictionaryWindow(state: DictionaryWindowState) {
  const win = state.dialog.window;
  const doc = win.document;
  const root = doc.getElementById(ROOT_ID);
  if (
    !root ||
    addon.data.shuttingDown ||
    addon.data.dictionaryWindow !== state
  ) {
    win.close();
    return;
  }
  // Keep the dictionary in its own HTML document. Reader popup dimensions and
  // its selection lifecycle must not control the result's visibility/lifetime.
  doc.body.replaceChildren(root);
  const style = element(doc, "style");
  style.textContent = `
    :root { color-scheme: light dark; }
    html, body { width: 100%; height: 100%; margin: 0 !important; padding: 0 !important; overflow: hidden; }
    #${ROOT_ID} { box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column;
      padding: 18px 20px; gap: 12px; background: Canvas; color: CanvasText; font: 14px/1.6 system-ui, sans-serif; }
    #${ROOT_ID} * { box-sizing: border-box; }
    .dictionary-header { display: flex; align-items: flex-start; gap: 12px; }
    .dictionary-heading { flex: 1; min-width: 0; }
    .dictionary-label { font-size: 11px; color: GrayText; }
    h1 { margin: 2px 0 0; font-size: 24px; line-height: 1.25; overflow-wrap: anywhere; }
    .dictionary-query { margin-top: 4px; font-size: 12px; color: GrayText; }
    .dictionary-body { flex: 0 1 auto; min-height: 0; overflow: auto; overflow-wrap: anywhere; }
    p { margin: 0 0 12px; }
    ol { margin: 0; padding-left: 22px; }
    li { margin-bottom: 10px; padding-left: 2px; }
    .dictionary-phonetic { color: GrayText; }
    .dictionary-pos { color: GrayText; font-size: 12px; margin-right: 7px; }
    .dictionary-source { margin: 14px 0 0; font-size: 11px; color: GrayText; }
    button { appearance: none; font: inherit; cursor: pointer; padding: 4px 9px;
      background: ButtonFace; color: ButtonText; border: 1px solid GrayText; border-radius: 5px; }
    button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    .dictionary-close { font-size: 12px; }
    .dictionary-more { align-self: flex-start; color: LinkText; background: transparent; border: 0; padding: 0; font-size: 12px; }
  `;
  doc.head.append(style);
  const heading = element(doc, "h1");
  const query = element(doc, "div", "", "dictionary-query");
  const headingGroup = element(doc, "div", "", "dictionary-heading");
  headingGroup.append(
    element(doc, "div", "NAVER Dictionary", "dictionary-label"),
    heading,
    query,
  );
  const close = element(
    doc,
    "button",
    dictionaryString("dictionary-close"),
    "dictionary-close",
  );
  close.type = "button";
  close.addEventListener("click", () => win.close());
  const header = element(doc, "header", "", "dictionary-header");
  header.append(headingGroup, close);
  const body = element(doc, "main", "", "dictionary-body");
  body.setAttribute("aria-live", "polite");
  const more = element(
    doc,
    "button",
    dictionaryString("dictionary-open-browser"),
    "dictionary-more",
  );
  more.type = "button";
  let sourceURL = state.lookup.url;
  more.addEventListener("click", () => Zotero.launchURL(sourceURL));
  root.replaceChildren(header, body, more);

  let active = true;
  let generation = 0;
  let request: ReturnType<typeof requestDictionary> | undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      win.close();
    }
  };
  doc.addEventListener("keydown", onKeyDown);
  state.dispose = () => {
    if (!active) return;
    active = false;
    generation++;
    request?.cancel();
    doc.removeEventListener("keydown", onKeyDown);
    state.refresh = undefined;
    if (addon.data.dictionaryWindow === state)
      addon.data.dictionaryWindow = undefined;
  };
  const load = async () => {
    const current = ++generation;
    request?.cancel();
    const lookup = state.lookup;
    heading.textContent = lookup.term;
    query.textContent = "";
    doc.title = `${lookup.term} · ${dictionaryString("reader-action-dictionary")}`;
    sourceURL = lookup.url;
    body.textContent = dictionaryString("dictionary-loading");
    body.setAttribute("aria-busy", "true");
    try {
      request = requestDictionary(lookup);
      const entry = await request.result;
      if (!active || current !== generation) return;
      if (entry) {
        heading.textContent = entry.headword;
        if (entry.headword.toLowerCase() !== lookup.term.toLowerCase())
          query.textContent = `${lookup.term} → ${entry.headword}`;
        body.replaceChildren(renderEntry(doc, entry));
        sourceURL = entry.url;
      } else {
        body.textContent = dictionaryString("dictionary-empty");
      }
    } catch (error) {
      if (!active || current !== generation) return;
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      const retry = element(
        doc,
        "button",
        dictionaryString("dictionary-retry"),
      );
      retry.type = "button";
      retry.addEventListener("click", () => void load(), { once: true });
      body.replaceChildren(
        element(doc, "p", dictionaryString("dictionary-error")),
        retry,
      );
    } finally {
      if (active && current === generation) {
        request = undefined;
        body.removeAttribute("aria-busy");
      }
    }
  };
  state.refresh = () => {
    void load();
  };
  // about:blank chrome windows can inherit oversized initial geometry on macOS.
  // Apply the compact size after replacing the toolkit's initial document.
  win.resizeTo(420, 380);
  state.refresh();
  close.focus();
}

/** A Zotero-owned modeless window containing parsed text, not a web viewer. */
export function openDictionaryPopup(lookup: DictionaryLookup) {
  if (addon.data.shuttingDown) return;
  const existing = addon.data.dictionaryWindow;
  if (existing && !existing.dialog.window.closed) {
    existing.lookup = lookup;
    existing.refresh?.();
    existing.dialog.window.focus();
    return;
  }
  existing?.dispose();
  const dialog = new DialogHelper(1, 1).addCell(0, 0, {
    tag: "div",
    namespace: "html",
    id: ROOT_ID,
    attributes: { "aria-label": dictionaryString("reader-action-dictionary") },
  });
  const state: DictionaryWindowState = {
    dialog,
    lookup,
    dispose: () => {
      if (addon.data.dictionaryWindow === state)
        addon.data.dictionaryWindow = undefined;
    },
  };
  addon.data.dictionaryWindow = state;
  try {
    dialog
      .setDialogData({
        loadCallback: () => mountDictionaryWindow(state),
        beforeUnloadCallback: () => state.dispose(),
        unloadCallback: () => state.dispose(),
      })
      .open(dictionaryString("reader-action-dictionary"), {
        width: 400,
        height: 360,
        centerscreen: true,
        resizable: true,
        fitContent: false,
        noDialogMode: false,
        alwaysRaised: false,
      });
  } catch (error) {
    state.dispose();
    throw error;
  }
}

export function buildDictionaryButton(doc: Document, text?: string) {
  const lookup = buildDictionaryLookup(text);
  if (!lookup) return undefined;
  const button = element(
    doc,
    "button",
    dictionaryString("reader-action-dictionary"),
    "pp-btn pp-btn--secondary pp-selection-action",
  );
  button.type = "button";
  button.title = dictionaryString("dictionary-lookup-hint");
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", () => {
    try {
      openDictionaryPopup(lookup);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      Zotero.alert(
        Zotero.getMainWindow(),
        dictionaryString("reader-action-dictionary"),
        dictionaryString("dictionary-error"),
      );
    }
  });
  return button;
}

export function closeDictionaryPopups() {
  const state = addon.data.dictionaryWindow;
  state?.dispose();
  if (state && !state.dialog.window.closed) state.dialog.window.close();
}
