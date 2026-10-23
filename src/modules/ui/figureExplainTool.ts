import { getString } from "../../utils/locale";
import {
  EXPLAIN_MODE_TIMEOUT_MS,
  matchArmedArea,
  restorableTool,
  type ArmedFigureReader,
} from "../figureExplain/explainMode";
import type { FigureExplainTarget } from "../figureExplain/workflow";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const TOOL_CLASS = "pp-figure-tool";
const HINT_CLASS = "pp-figure-tool-hint";
/** How long the "selection ended" notice stays after the mode times out. */
const HINT_NOTICE_MS = 6000;
const hintTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const OBSERVER_NAME = "paperpilot-figure-explain";

export type FigureToolReader = {
  _instanceID?: string;
  _type?: string;
  itemID?: number;
  _item?: { id?: number };
  _iframeWindow?: Window;
  _internalReader?: {
    toolType?: string;
    setTool?: (params: unknown) => void;
    _state?: { readOnly?: boolean };
    _primaryView?: { _iframeWindow?: Window };
    _secondaryView?: { _iframeWindow?: Window };
  };
};

/**
 * The reader frame plus the PDF view frames. The PDF view handles keys in
 * its own frame and swallows Escape there, so listen on each of them.
 */
function keyWindows(reader: FigureToolReader): Window[] {
  const internal = reader._internalReader;
  return [
    reader._iframeWindow,
    internal?._primaryView?._iframeWindow,
    internal?._secondaryView?._iframeWindow,
  ].filter((win, index, all): win is Window =>
    Boolean(win && all.indexOf(win) === index),
  );
}

export interface FigureModeEntry extends ArmedFigureReader {
  reader: FigureToolReader;
  timer: ReturnType<typeof setTimeout>;
  onArea: (target: FigureExplainTarget) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onUnload: () => void;
  keyWindows?: Window[];
}

function entries(): Map<string, FigureModeEntry> {
  addon.data.figureExplainModes ??= new Map();
  return addon.data.figureExplainModes;
}

function logError(error: unknown) {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}

function readerID(reader: FigureToolReader) {
  return String(reader._instanceID || "");
}

function readerAttachmentID(reader: FigureToolReader) {
  return Number(reader._item?.id ?? reader.itemID);
}

function currentTool(reader: FigureToolReader) {
  try {
    return String(reader._internalReader?.toolType || "");
  } catch {
    return "";
  }
}

function isReadOnly(reader: FigureToolReader) {
  try {
    return Boolean(reader._internalReader?._state?.readOnly);
  } catch {
    return false;
  }
}

// The reader runs in its own compartment, so its tool parameters are cloned.
function setReaderTool(reader: FigureToolReader, type: string) {
  const internal = reader._internalReader;
  const win = reader._iframeWindow;
  if (typeof internal?.setTool !== "function" || !win) return false;
  try {
    const utils = (globalThis as { Components?: any }).Components?.utils;
    internal.setTool(
      utils?.cloneInto ? utils.cloneInto({ type }, win) : { type },
    );
    return true;
  } catch (error) {
    logError(error);
    return false;
  }
}

function syncButtons(reader: FigureToolReader) {
  const armed = entries().has(readerID(reader));
  // A closed reader leaves a dead window; there is nothing left to update.
  if (!reader._iframeWindow || reader._iframeWindow.closed) return;
  const doc = reader._iframeWindow?.document;
  const buttons = Array.from(
    doc?.querySelectorAll(`button.${TOOL_CLASS}`) ?? [],
  ) as HTMLButtonElement[];
  for (const button of buttons) {
    button.classList.toggle("active", armed);
    button.setAttribute("aria-pressed", String(armed));
    button.title = getString(
      armed ? "figure-explain-tool-armed" : "figure-explain-tool",
    );
  }
}

/**
 * The armed instructions used to live only in the button tooltip, and the
 * two-minute timeout ended the mode without a word. A small status line over
 * the PDF says what to do and when the mode ended. No text removes it.
 */
function showFigureHint(
  reader: FigureToolReader,
  text?: string,
  durationMs?: number,
) {
  const win = reader._iframeWindow;
  if (!win || win.closed) return;
  const doc = win.document;
  const timer = hintTimers.get(doc);
  if (timer) clearTimeout(timer);
  hintTimers.delete(doc);
  let hint = doc.querySelector(`.${HINT_CLASS}`) as HTMLElement | null;
  if (!text) {
    hint?.remove();
    return;
  }
  if (!hint) {
    hint = doc.createElementNS(HTML_NS, "div") as HTMLElement;
    hint.className = HINT_CLASS;
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");
    Object.assign(hint.style, {
      position: "fixed",
      top: "48px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "1000",
      maxWidth: "80%",
      padding: "6px 10px",
      borderRadius: "6px",
      background: "rgba(0, 0, 0, 0.8)",
      color: "#fff",
      font: "12px/1.4 system-ui, sans-serif",
      textAlign: "center",
      pointerEvents: "none",
    });
    (doc.body ?? doc.documentElement)?.appendChild(hint);
  }
  hint.textContent = text;
  if (durationMs) {
    const shown = hint;
    hintTimers.set(
      doc,
      setTimeout(() => {
        hintTimers.delete(doc);
        // The reader tab may have closed; its document is then dead.
        try {
          shown.remove();
        } catch (error) {
          logError(error);
        }
      }, durationMs),
    );
  }
}

function unregisterObserver() {
  const id = addon.data.figureExplainObserverID;
  addon.data.figureExplainObserverID = undefined;
  if (id) Zotero.Notifier.unregisterObserver(id);
}

function dateAddedMs(item: { dateAdded?: string }) {
  try {
    const date = Zotero.Date.sqlToDate(String(item.dateAdded || ""), true);
    return date ? date.getTime() : undefined;
  } catch {
    return undefined;
  }
}

function completeArea(id: number | string) {
  const item = Zotero.Items.get(Number(id));
  if (!item?.isAnnotation?.()) return;
  const match = matchArmedArea(
    [...entries().values()],
    {
      key: String(item.key || ""),
      annotationType: String(item.annotationType || ""),
      parentItemID: Number(item.parentItemID),
      dateAdded: dateAddedMs(item),
    },
    Date.now(),
  );
  if (!match) return;
  const entry = entries().get(match.readerID);
  disarmFigureMode(match.readerID);
  entry?.onArea({
    attachmentID: match.attachmentID,
    annotationKey: String(item.key),
  });
}

function ensureObserver() {
  if (addon.data.figureExplainObserverID) return;
  addon.data.figureExplainObserverID = Zotero.Notifier.registerObserver(
    {
      notify: (event: string, type: string, ids: Array<number | string>) => {
        if (event !== "add" || type !== "item") return;
        for (const id of ids) {
          try {
            completeArea(id);
          } catch (error) {
            logError(error);
          }
        }
      },
    },
    ["item"],
    OBSERVER_NAME,
  );
}

/** Ends the mode and returns the reader to the tool it had before. */
export function disarmFigureMode(id: string, restoreTool = true) {
  const entry = entries().get(id);
  if (!entry) return;
  entries().delete(id);
  clearTimeout(entry.timer);
  try {
    const win = entry.reader._iframeWindow;
    for (const keyWindow of entry.keyWindows ?? [win]) {
      keyWindow?.removeEventListener("keydown", entry.onKeyDown, true);
    }
    win?.removeEventListener("unload", entry.onUnload);
    if (restoreTool && currentTool(entry.reader) === "image")
      setReaderTool(entry.reader, entry.previousTool);
    syncButtons(entry.reader);
    showFigureHint(entry.reader);
  } catch (error) {
    // A closed reader throws "dead object"; the mode is already removed.
    logError(error);
  } finally {
    if (!entries().size) unregisterObserver();
  }
}

/**
 * Switches the reader to Zotero's area tool. The next area drawn in this PDF
 * is handed to `onArea`, then the previous tool comes back.
 */
export function armFigureMode(
  reader: FigureToolReader,
  onArea: (target: FigureExplainTarget) => void,
) {
  const id = readerID(reader);
  const attachmentID = readerAttachmentID(reader);
  if (!id || !attachmentID || isReadOnly(reader)) return;
  disarmFigureMode(id, false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") disarmFigureMode(id);
  };
  const onUnload = () => disarmFigureMode(id, false);
  const entry: FigureModeEntry = {
    readerID: id,
    attachmentID,
    previousTool: restorableTool(currentTool(reader)),
    armedAt: Date.now(),
    reader,
    onArea,
    onKeyDown,
    onUnload,
    timer: setTimeout(() => {
      disarmFigureMode(id);
      try {
        showFigureHint(
          reader,
          getString("figure-explain-tool-timeout"),
          HINT_NOTICE_MS,
        );
      } catch (error) {
        logError(error);
      }
    }, EXPLAIN_MODE_TIMEOUT_MS),
  };
  entry.keyWindows = keyWindows(reader);
  entries().set(id, entry);
  ensureObserver();
  for (const keyWindow of entry.keyWindows) {
    keyWindow.addEventListener("keydown", onKeyDown, true);
  }
  reader._iframeWindow?.addEventListener("unload", onUnload, { once: true });
  setReaderTool(reader, "image");
  syncButtons(reader);
  showFigureHint(reader, getString("figure-explain-tool-armed"));
}

export function disarmAllFigureModes() {
  for (const id of [...entries().keys()]) {
    try {
      disarmFigureMode(id);
    } catch (error) {
      logError(error);
    }
  }
  unregisterObserver();
}

function toolIcon(doc: Document) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const frame = doc.createElementNS(SVG_NS, "rect");
  for (const [name, value] of Object.entries({
    x: "2.5",
    y: "3.5",
    width: "15",
    height: "13",
    rx: "1.5",
    "stroke-width": "1.25",
    "stroke-dasharray": "2 1.5",
  }))
    frame.setAttribute(name, value);
  const bars = doc.createElementNS(SVG_NS, "path");
  bars.setAttribute("d", "M6.5 13.5v-3M10 13.5v-6M13.5 13.5v-4");
  bars.setAttribute("stroke-width", "1.6");
  bars.setAttribute("stroke-linecap", "round");
  svg.append(frame, bars);
  return svg;
}

/** The reader toolbar button that starts one figure selection. */
export function buildFigureToolButton(
  doc: Document,
  reader: FigureToolReader,
  onArea: (target: FigureExplainTarget) => void,
) {
  const button = doc.createElementNS(HTML_NS, "button") as HTMLButtonElement;
  button.type = "button";
  button.className = `toolbar-button ${TOOL_CLASS}`;
  button.tabIndex = -1;
  button.setAttribute("aria-label", getString("figure-explain-tool-label"));
  button.append(toolIcon(doc));
  if (isReadOnly(reader)) {
    button.disabled = true;
    button.title = getString("figure-explain-tool-read-only");
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Open readers keep this button after the add-on is disabled.
    if (typeof addon === "undefined" || !addon.data.alive) return;
    if (entries().has(readerID(reader))) disarmFigureMode(readerID(reader));
    else armFigureMode(reader, onArea);
  });
  // Toolbar re-renders rebuild the button; keep its state from the mode.
  const armed = entries().has(readerID(reader));
  button.classList.toggle("active", armed);
  button.setAttribute("aria-pressed", String(armed));
  if (!button.disabled)
    button.title = getString(
      armed ? "figure-explain-tool-armed" : "figure-explain-tool",
    );
  return button;
}
