import { DialogHelper } from "zotero-plugin-toolkit";
import { getString } from "../../utils/locale";
import { figureWindowPosition } from "../figureExplain/explainMode";
import type {
  FigureEvidenceBasis,
  FigureExplanation,
  FigureKind,
  FigureRegion,
} from "../figureExplain/types";
import {
  explainFigure,
  prepareFigure,
  resolveFigureRegion,
  type FigureExplainResult,
  type FigureExplainTarget,
  type PreparedFigure,
} from "../figureExplain/workflow";

declare const IOUtils: any;

const ROOT_ID = "paperpilot-figure-window";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const WINDOW_TITLE = "Figure explanation · Paper Pilot";
const WINDOW_SIZE = { width: 500, height: 660 };
const FALLBACK_HEADING = "Selected area";

const KIND_LABELS: Record<FigureKind, string> = {
  table: "Table",
  chart: "Chart",
  diagram: "Diagram",
  image: "Image",
  other: "Page area",
};

const BASIS_LABELS: Record<FigureEvidenceBasis, [string, string]> = {
  visual: ["Visible", "Read from the selected image"],
  "paper-text": ["Paper", "Stated in the paper text"],
  inference: ["Inference", "The engine's interpretation"],
};

export type FigureExplainWindowState = {
  dialog: DialogHelper;
  target: FigureExplainTarget;
  request?: (target: FigureExplainTarget, force?: boolean) => void;
  dispose: () => void;
};

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

function button(doc: Document, label: string, className = "") {
  const node = element(doc, "button", label, className);
  node.type = "button";
  return node;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "The figure explanation failed. Retry the request.";
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const STYLE = `
  :root { color-scheme: light dark; }
  html, body { width: 100%; height: 100%; margin: 0 !important; padding: 0 !important; overflow: hidden; }
  #${ROOT_ID} { box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column;
    background: Canvas; color: CanvasText; font: 13px/1.55 system-ui, sans-serif; }
  #${ROOT_ID} * { box-sizing: border-box; }
  .figure-header { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px 10px; }
  .figure-heading { flex: 1; min-width: 0; }
  .figure-eyebrow { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: GrayText; }
  h1 { margin: 2px 0 0; font-size: 20px; line-height: 1.25; overflow-wrap: anywhere; }
  .figure-meta { margin-top: 2px; font-size: 12px; color: GrayText; }
  .figure-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; overflow-wrap: anywhere; }
  .figure-preview { margin: 0 18px; padding: 8px; border-radius: 8px;
    border: 1px solid color-mix(in srgb, GrayText 35%, transparent);
    background: color-mix(in srgb, CanvasText 4%, Canvas); }
  .figure-preview img { display: block; max-width: 100%; max-height: 200px; margin: 0 auto;
    object-fit: contain; background: #fff; border-radius: 4px; }
  .figure-preview figcaption { margin-top: 6px; font-size: 12px; color: GrayText; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .figure-preview figcaption:empty { display: none; }
  .figure-no-image { margin: 0; font-size: 12px; color: GrayText; }
  .figure-status { display: flex; align-items: center; gap: 8px; margin: 12px 18px 0; padding: 7px 10px;
    border-radius: 6px; font-size: 12px; background: color-mix(in srgb, Highlight 10%, Canvas); }
  .figure-status[hidden] { display: none; }
  .figure-status--error { background: color-mix(in srgb, #d70022 14%, Canvas); }
  .figure-status-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .figure-elapsed { color: GrayText; font-variant-numeric: tabular-nums; }
  .figure-spinner { flex: none; width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid Highlight; border-right-color: transparent; animation: figure-spin 0.9s linear infinite; }
  .figure-status:not(.is-running) .figure-spinner { display: none; }
  @keyframes figure-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .figure-spinner { animation: none; border-right-color: Highlight; } }
  .figure-body { padding: 2px 18px 16px; }
  h2 { margin: 14px 0 4px; font-size: 15px; line-height: 1.35; }
  .figure-summary { margin: 0; font-size: 14px; }
  h3 { margin: 16px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
    text-transform: uppercase; color: GrayText; }
  p { margin: 0; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 4px 0; }
  .figure-points { list-style: none; padding: 0; }
  .figure-points li { display: flex; align-items: baseline; gap: 8px; }
  .figure-basis { flex: none; min-width: 64px; padding: 0 6px; border: 1px solid; border-radius: 999px;
    font-size: 10px; font-weight: 600; line-height: 16px; letter-spacing: 0.03em; text-align: center;
    text-transform: uppercase; }
  .figure-basis--visual { border-color: Highlight; background: color-mix(in srgb, Highlight 16%, Canvas); }
  .figure-basis--paper-text { border-color: color-mix(in srgb, CanvasText 45%, transparent); }
  .figure-basis--inference { border-style: dashed; border-color: GrayText; color: GrayText; }
  .figure-footer { display: flex; align-items: center; gap: 10px; padding: 9px 18px;
    border-top: 1px solid color-mix(in srgb, GrayText 30%, transparent); font-size: 11px; color: GrayText; }
  .figure-footer-text { flex: 1; min-width: 0; }
  button { appearance: none; font: inherit; font-size: 12px; cursor: pointer; padding: 3px 10px;
    background: ButtonFace; color: ButtonText; border: 1px solid GrayText; border-radius: 5px; }
  button:hover:not(:disabled) { border-color: Highlight; }
  button:active:not(:disabled) { background: Highlight; color: HighlightText; }
  button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
  button[hidden] { display: none; }
`;

function renderList(doc: Document, items: readonly string[]) {
  const list = element(doc, "ul");
  for (const item of items) list.append(element(doc, "li", item));
  return list;
}

function renderSection(doc: Document, heading: string, content: Node) {
  const section = element(doc, "section");
  section.append(element(doc, "h3", heading), content);
  return section;
}

function renderExplanation(doc: Document, explanation: FigureExplanation) {
  const article = element(doc, "article");
  article.append(
    element(doc, "h2", explanation.title || FALLBACK_HEADING),
    element(doc, "p", explanation.summary, "figure-summary"),
  );
  if (explanation.howToRead.length)
    article.append(
      renderSection(doc, "How to read", renderList(doc, explanation.howToRead)),
    );
  const points = element(doc, "ul", "", "figure-points");
  for (const point of explanation.keyPoints) {
    const [label, description] = BASIS_LABELS[point.basis];
    const badge = element(
      doc,
      "span",
      label,
      `figure-basis figure-basis--${point.basis}`,
    );
    badge.title = description;
    const row = element(doc, "li");
    row.append(badge, element(doc, "span", point.text));
    points.append(row);
  }
  article.append(renderSection(doc, "Key points", points));
  if (explanation.paperContext)
    article.append(
      renderSection(
        doc,
        "In the paper",
        element(doc, "p", explanation.paperContext),
      ),
    );
  if (explanation.caveats.length)
    article.append(
      renderSection(doc, "Caveats", renderList(doc, explanation.caveats)),
    );
  return article;
}

function mountFigureWindow(state: FigureExplainWindowState) {
  const win = state.dialog.window;
  const doc = win.document;
  const root = doc.getElementById(ROOT_ID);
  if (
    !root ||
    addon.data.shuttingDown ||
    addon.data.figureExplainWindow !== state
  ) {
    win.close();
    return;
  }
  // Own document, like the dictionary: reader popup lifecycles never apply.
  doc.body.replaceChildren(root);
  const style = element(doc, "style");
  style.textContent = STYLE;
  doc.head.append(style);

  const heading = element(doc, "h1", FALLBACK_HEADING);
  const meta = element(doc, "div", "", "figure-meta");
  const headingGroup = element(doc, "div", "", "figure-heading");
  headingGroup.append(
    element(doc, "div", "Paper Pilot · Figure explanation", "figure-eyebrow"),
    heading,
    meta,
  );
  const close = button(doc, "Close");
  close.addEventListener("click", () => win.close());
  const header = element(doc, "header", "", "figure-header");
  header.append(headingGroup, close);

  const preview = element(doc, "figure", "", "figure-preview");
  const image = element(doc, "img");
  image.alt = "The selected area of the PDF page";
  const caption = element(doc, "figcaption");
  preview.hidden = true;

  const status = element(doc, "div", "", "figure-status");
  status.setAttribute("role", "status");
  const spinner = element(doc, "span", "", "figure-spinner");
  const statusText = element(doc, "span", "", "figure-status-text");
  const elapsed = element(doc, "span", "", "figure-elapsed");
  const stop = button(doc, "Stop");
  const retry = button(doc, "Retry");
  status.append(spinner, statusText, elapsed, stop, retry);

  const body = element(doc, "div", "", "figure-body");
  body.setAttribute("aria-live", "polite");
  // Image, status, and explanation scroll together, so a long answer gets
  // the whole window height once the reader scrolls past the image.
  const scroll = element(doc, "main", "", "figure-scroll");
  scroll.append(preview, status, body);
  const footerText = element(doc, "div", "", "figure-footer-text");
  const regenerate = button(doc, "Regenerate");
  regenerate.title = "Run the explanation again instead of reusing it";
  const footer = element(doc, "footer", "", "figure-footer");
  footer.append(footerText, regenerate);
  root.replaceChildren(header, scroll, footer);

  let active = true;
  let generation = 0;
  let controller: AbortController | undefined;
  let running: Promise<void> = Promise.resolve();
  let inFlight = false;
  let startedGeneration = 0;
  let imageURL: string | undefined;
  let timer: ReturnType<typeof win.setInterval> | undefined;

  const releaseImage = () => {
    if (imageURL) win.URL.revokeObjectURL(imageURL);
    imageURL = undefined;
  };
  const stopTimer = () => {
    if (timer !== undefined) win.clearInterval(timer);
    timer = undefined;
  };
  const setStatus = (
    text: string,
    mode: "running" | "idle" | "error" = "running",
  ) => {
    status.hidden = false;
    status.classList.toggle("is-running", mode === "running");
    status.classList.toggle("figure-status--error", mode === "error");
    statusText.textContent = text;
    stop.hidden = mode !== "running";
    retry.hidden = mode === "running";
    if (mode !== "running") {
      stopTimer();
      elapsed.textContent = "";
    }
  };
  const startTimer = () => {
    stopTimer();
    const startedAt = Date.now();
    elapsed.textContent = formatElapsed(0);
    timer = win.setInterval(() => {
      elapsed.textContent = formatElapsed(Date.now() - startedAt);
    }, 1000);
  };

  const showRegion = (region: FigureRegion) => {
    meta.textContent = `Page ${region.pageLabel}`;
  };
  const showPrepared = async (
    prepared: PreparedFigure,
    isCurrent: () => boolean,
  ) => {
    if (prepared.hints.label) heading.textContent = prepared.hints.label;
    caption.textContent = prepared.hints.caption ?? "";
    releaseImage();
    preview.hidden = false;
    if (!prepared.imagePath) {
      preview.replaceChildren(
        element(
          doc,
          "p",
          "Zotero has no image of this area yet. The explanation uses the caption and page text only.",
          "figure-no-image",
        ),
        caption,
      );
      return;
    }
    try {
      const bytes = await IOUtils.read(prepared.imagePath);
      if (!isCurrent()) return;
      const blob = new win.Blob([new win.Uint8Array(bytes)], {
        type: "image/png",
      });
      const url = win.URL.createObjectURL(blob);
      imageURL = url;
      image.src = url;
      preview.replaceChildren(image, caption);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      preview.replaceChildren(caption);
    }
  };
  const showResult = (region: FigureRegion, result: FigureExplainResult) => {
    const { explanation } = result;
    const title = explanation.label || heading.textContent || FALLBACK_HEADING;
    heading.textContent = title;
    meta.textContent = `Page ${region.pageLabel} · ${KIND_LABELS[explanation.kind]}`;
    doc.title = `${title} · ${WINDOW_TITLE}`;
    body.replaceChildren(renderExplanation(doc, explanation));
    scroll.scrollTop = 0;
    status.hidden = true;
    stopTimer();
    footerText.textContent = [
      result.engineLabel,
      result.hasImage ? "Selected image and paper text" : "Text only",
      result.cached ? "Reused from this session" : "Not saved",
    ].join(" · ");
    regenerate.hidden = false;
  };

  const execute = async (
    current: number,
    target: FigureExplainTarget,
    signal: AbortSignal,
    force: boolean,
  ) => {
    const isCurrent = () => active && current === generation;
    inFlight = true;
    setStatus("Reading the selected area…");
    startTimer();
    try {
      const region = await resolveFigureRegion(target);
      if (!isCurrent()) return;
      showRegion(region);
      const prepared = await prepareFigure(region);
      if (!isCurrent()) return;
      await showPrepared(prepared, isCurrent);
      if (signal.aborted) throw new Error("Stopped.");
      const result = await explainFigure({
        region,
        prepared,
        force,
        signal,
        onStatus: (text) => {
          if (isCurrent()) setStatus(text);
        },
      });
      if (isCurrent()) showResult(region, result);
    } catch (error) {
      if (!isCurrent()) return;
      if (signal.aborted) setStatus("Stopped.", "idle");
      else setStatus(errorMessage(error), "error");
    } finally {
      inFlight = false;
    }
  };

  const resetView = () => {
    heading.textContent = FALLBACK_HEADING;
    meta.textContent = "";
    doc.title = WINDOW_TITLE;
    preview.hidden = true;
    releaseImage();
    body.replaceChildren();
    footerText.textContent = "";
    regenerate.hidden = true;
    stop.disabled = false;
    setStatus(
      inFlight
        ? "Stopping the previous explanation…"
        : "Reading the selected area…",
    );
  };

  // A new request stops the previous run and waits for its cleanup, because
  // the engine slot for the paper stays reserved until then.
  const request = (target: FigureExplainTarget, force = false) => {
    state.target = target;
    const current = ++generation;
    controller?.abort();
    resetView();
    const previous = running;
    running = previous
      .then(async () => {
        if (!active || current !== generation) return;
        // The add-on sandbox has no AbortController; the window provides one.
        const run = new win.AbortController();
        controller = run;
        startedGeneration = current;
        await execute(current, target, run.signal, force);
      })
      .catch((error) =>
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
  };

  stop.addEventListener("click", () => {
    controller?.abort();
    if (startedGeneration !== generation) {
      // The request still waits for the previous run; never start it.
      generation++;
      setStatus("Stopped.", "idle");
      return;
    }
    stop.disabled = true;
    statusText.textContent = "Stopping…";
  });
  const retryCurrent = () => request(state.target, true);
  retry.addEventListener("click", retryCurrent);
  regenerate.addEventListener("click", retryCurrent);

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
    controller?.abort();
    stopTimer();
    releaseImage();
    doc.removeEventListener("keydown", onKeyDown);
    state.request = undefined;
    if (addon.data.figureExplainWindow === state)
      addon.data.figureExplainWindow = undefined;
  };
  state.request = request;
  win.resizeTo(WINDOW_SIZE.width, WINDOW_SIZE.height);
  const position = windowPosition();
  if (position) win.moveTo(position.left, position.top);
  state.request(state.target);
  close.focus();
}

function windowPosition() {
  const main = Zotero.getMainWindow();
  if (!main?.screen) return undefined;
  return figureWindowPosition(main, WINDOW_SIZE, main.screen);
}

/** A modeless Zotero window; closing it stops the run it started. */
export function openFigureExplainPopup(target: FigureExplainTarget) {
  if (addon.data.shuttingDown) return;
  const existing = addon.data.figureExplainWindow;
  if (existing && !existing.dialog.window.closed && existing.request) {
    existing.request(target);
    existing.dialog.window.focus();
    return;
  }
  existing?.dispose();
  const dialog = new DialogHelper(1, 1).addCell(0, 0, {
    tag: "div",
    namespace: "html",
    id: ROOT_ID,
    attributes: { "aria-label": WINDOW_TITLE },
  });
  const state: FigureExplainWindowState = {
    dialog,
    target,
    dispose: () => {
      if (addon.data.figureExplainWindow === state)
        addon.data.figureExplainWindow = undefined;
    },
  };
  addon.data.figureExplainWindow = state;
  try {
    dialog
      .setDialogData({
        loadCallback: () => mountFigureWindow(state),
        beforeUnloadCallback: () => state.dispose(),
        unloadCallback: () => state.dispose(),
      })
      .open(WINDOW_TITLE, {
        ...WINDOW_SIZE,
        ...(windowPosition() ?? {}),
        centerscreen: !windowPosition(),
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

function openSafely(target: FigureExplainTarget) {
  try {
    openFigureExplainPopup(target);
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    Zotero.alert(
      Zotero.getMainWindow(),
      WINDOW_TITLE,
      "Paper Pilot could not open the figure explanation window.",
    );
  }
}

/**
 * Opens or reuses the window from a fresh main-thread task. Reader menus run
 * their commands from a timer in the reader iframe, and opening a chrome
 * window from that task crashed Zotero 10.0.6 (native SIGSEGV).
 */
export function showFigureExplanation(target: FigureExplainTarget) {
  const threads = (globalThis as { Services?: any }).Services?.tm;
  if (typeof threads?.dispatchToMainThread === "function")
    threads.dispatchToMainThread(() => openSafely(target));
  else setTimeout(() => openSafely(target), 0);
}

/** A compact button for area-annotation cards in the reader sidebar. */
export function buildFigureExplainButton(
  doc: Document,
  target: FigureExplainTarget,
) {
  const node = element(
    doc,
    "button",
    getString("figure-explain-button"),
    "pp-annotation-explain",
  );
  node.type = "button";
  node.title = getString("figure-explain-button-hint");
  node.setAttribute("aria-haspopup", "dialog");
  // The sidebar card selects its annotation on click; keep that selection.
  const swallow = (event: Event) => event.stopPropagation();
  node.addEventListener("mousedown", swallow);
  node.addEventListener("pointerdown", swallow);
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    showFigureExplanation(target);
  });
  return node;
}

export function closeFigureExplainPopups() {
  const state = addon.data.figureExplainWindow;
  state?.dispose();
  if (state && !state.dialog.window.closed) state.dialog.window.close();
}
