import { getPref, setPref } from "../../utils/prefs";
import {
  DEFAULT_PANE_SECTION_STATE,
  parsePaneSectionState,
  serializePaneSectionState,
  type PaneSectionID,
} from "./paneSectionState";
import { createVerticalResizeHandle } from "./paneResize";

export interface CollapsibleSectionHandle {
  root: HTMLElement;
  body: HTMLElement;
  setSummary(text: string): void;
  setExpanded(expanded: boolean, persist?: boolean): void;
  isExpanded(): boolean;
  markUpdated(): void;
  dispose(): void;
}

export function createCollapsibleSection(params: {
  doc: Document;
  id: PaneSectionID;
  title: string;
  defaultExpanded: boolean;
  initialBodyHeight?: number;
  getMaxBodyHeight?(): number;
  onBodyHeightChange?(height: number | undefined): void;
}): CollapsibleSectionHandle {
  const persisted = parsePaneSectionState(getPref("paneSectionState"), {
    ...DEFAULT_PANE_SECTION_STATE,
    [params.id]: params.defaultExpanded,
  });
  let expanded = persisted[params.id];

  const root = params.doc.createElement("section");
  root.id = `paper-pilot-${params.id}-section`;
  root.className = "pp-collapsible-section";

  const trigger = params.doc.createElement("button");
  trigger.type = "button";
  trigger.id = `paper-pilot-${params.id}-toggle`;
  trigger.className = "pp-collapsible-section__trigger";
  trigger.dataset.ppSectionTrigger = params.id;

  const chevron = params.doc.createElement("span");
  chevron.className = "pp-collapsible-section__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";

  const title = params.doc.createElement("span");
  title.className = "pp-collapsible-section__title";
  title.textContent = params.title;

  const summary = params.doc.createElement("span");
  summary.className = "pp-collapsible-section__summary";

  const updated = params.doc.createElement("span");
  updated.className = "pp-collapsible-section__updated";
  updated.setAttribute("aria-label", "Updated while collapsed");
  updated.hidden = true;

  const body = params.doc.createElement("div");
  body.id = `paper-pilot-${params.id}-body`;
  body.className = "pp-collapsible-section__body";

  const resizeHandle = createVerticalResizeHandle({
    doc: params.doc,
    target: body,
    label: `Resize ${params.title}`,
    minHeight: 96,
    getMaxHeight: params.getMaxBodyHeight ?? (() => 1200),
    initialHeight: params.initialBodyHeight,
    onHeightChange: params.onBodyHeightChange,
  });
  resizeHandle.root.classList.add("pp-resize-handle--section");

  trigger.setAttribute("aria-controls", body.id);
  trigger.append(chevron, title, summary, updated);
  root.append(trigger, body, resizeHandle.root);

  const render = () => {
    trigger.setAttribute("aria-expanded", String(expanded));
    body.hidden = !expanded;
    root.classList.toggle("pp-collapsible-section--expanded", expanded);
    if (expanded) {
      updated.hidden = true;
    }
  };

  const setExpanded = (next: boolean, persist = true) => {
    expanded = next;
    render();
    if (persist) {
      const state = parsePaneSectionState(getPref("paneSectionState"));
      state[params.id] = expanded;
      setPref("paneSectionState", serializePaneSectionState(state));
    }
  };

  const onToggle = () => setExpanded(!expanded);
  trigger.addEventListener("click", onToggle);
  render();
  let disposed = false;

  return {
    root,
    body,
    setSummary(text) {
      summary.textContent = text.trim();
      summary.hidden = !summary.textContent;
    },
    setExpanded,
    isExpanded: () => expanded,
    markUpdated() {
      if (!expanded) {
        updated.hidden = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      trigger.removeEventListener("click", onToggle);
      resizeHandle.dispose();
    },
  };
}
