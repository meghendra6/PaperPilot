import { config } from "../../../package.json";
import { getPref, setPref } from "../../utils/prefs";
import {
  describeRetrievalChunking,
  resolveRetrievalChunking,
  type RetrievalAdjustmentMessage,
} from "../context/retrievalSettings";
import {
  isSessionHistoryMode,
  resolveSessionHistoryPrefs,
  sessionHistoryPrefWrites,
} from "../session/historyPrefs";
import { maxOverlapForChunkSize } from "../tools/splitTextIntoChunks";
import {
  CHOICE_PREFERENCE_FIELDS,
  resolveChoicePreference,
  type ChoicePreferenceField,
} from "./choiceFields";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Id suffixes in preferences.xhtml that the bindings below look up. */
export const PREF_PANE_ELEMENT_SUFFIXES = {
  historyMode: "history-mode",
  chunkSize: "input-chunk-size",
  overlapSize: "input-overlap-size",
  chunkSizeWarning: "chunk-size-warning",
  overlapSizeWarning: "overlap-size-warning",
  retrievalAdvanced: "retrieval-advanced",
} as const;

function findPaneElement<T extends Element>(doc: Document, suffix: string) {
  return doc.querySelector<T>(`#zotero-prefpane-${config.addonRef}-${suffix}`);
}

/** Reopening settings reruns the load hook. Attach listeners only once. */
function bindOnce(element: HTMLElement, bind: () => void) {
  if (element.dataset.prefBound === "true") return;
  element.dataset.prefBound = "true";
  bind();
}

function setFluentMessage(
  element: Element,
  message: { l10nId: string; args: Readonly<Record<string, unknown>> },
) {
  element.setAttribute("data-l10n-id", message.l10nId);
  element.setAttribute("data-l10n-args", JSON.stringify(message.args));
}

function listOptions(select: HTMLSelectElement) {
  return Array.from(select.querySelectorAll("option")) as HTMLOptionElement[];
}

/** Drops the "not recognized" entry once it no longer matches `keepValue`. */
function removeStaleUnrecognizedOptions(
  select: HTMLSelectElement,
  keepValue: string,
) {
  for (const option of listOptions(select)) {
    const isStale =
      option.dataset.unrecognizedPref === "true" && option.value !== keepValue;
    if (isStale) option.remove();
  }
}

function syncChoiceSelect(
  doc: Document,
  select: HTMLSelectElement,
  field: ChoicePreferenceField,
) {
  const resolution = resolveChoicePreference(field, getPref(field.key));
  if (resolution.kind === "known" && resolution.repaired) {
    // A recognized spelling such as "acceptedits" keeps its meaning.
    setPref(field.key, resolution.value);
  }
  removeStaleUnrecognizedOptions(select, resolution.value);
  const hasOption = listOptions(select).some(
    (option) => option.value === resolution.value,
  );
  if (resolution.kind === "unrecognized" && !hasOption) {
    // Show unknown saved text instead of silently replacing it.
    const option = doc.createElementNS(XHTML_NS, "option") as HTMLOptionElement;
    option.value = resolution.value;
    option.dataset.unrecognizedPref = "true";
    setFluentMessage(option, {
      l10nId: field.unrecognizedL10nId,
      args: { value: resolution.value },
    });
    select.appendChild(option);
  }
  select.value = resolution.value;
}

function bindChoicePreferences(doc: Document) {
  for (const field of CHOICE_PREFERENCE_FIELDS) {
    const select = findPaneElement<HTMLSelectElement>(
      doc,
      `input-${field.inputSuffix}`,
    );
    if (!select) continue;
    syncChoiceSelect(doc, select, field);
    bindOnce(select, () => {
      // Zotero writes the selected value to the preference itself.
      select.addEventListener("change", () =>
        removeStaleUnrecognizedOptions(select, select.value),
      );
      select.addEventListener("syncfrompreference", () =>
        syncChoiceSelect(doc, select, field),
      );
    });
  }
}

function bindSessionHistoryChoice(doc: Document) {
  const group = findPaneElement<HTMLElement>(
    doc,
    PREF_PANE_ELEMENT_SUFFIXES.historyMode,
  );
  if (!group) return;
  const radios = Array.from(
    group.querySelectorAll('input[type="radio"]'),
  ) as HTMLInputElement[];
  const sync = () => {
    const mode = resolveSessionHistoryPrefs().mode;
    for (const radio of radios) radio.checked = radio.value === mode;
  };
  sync();
  bindOnce(group, () => {
    for (const radio of radios) {
      radio.addEventListener("change", () => {
        if (!radio.checked || !isSessionHistoryMode(radio.value)) return;
        for (const [key, value] of sessionHistoryPrefWrites(radio.value)) {
          setPref(key, value);
        }
        sync();
      });
    }
  });
}

function showAdjustment(
  input: HTMLInputElement,
  warning: HTMLElement | null,
  message: RetrievalAdjustmentMessage | undefined,
) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  if (!warning) return;
  warning.hidden = !message;
  if (message) setFluentMessage(warning, message);
}

function bindRetrievalValidation(doc: Document) {
  const ids = PREF_PANE_ELEMENT_SUFFIXES;
  const chunkInput = findPaneElement<HTMLInputElement>(doc, ids.chunkSize);
  const overlapInput = findPaneElement<HTMLInputElement>(doc, ids.overlapSize);
  if (!chunkInput || !overlapInput) return;
  const chunkWarning = findPaneElement<HTMLElement>(doc, ids.chunkSizeWarning);
  const overlapWarning = findPaneElement<HTMLElement>(
    doc,
    ids.overlapSizeWarning,
  );
  // Validate the stored values, because those are what the next run uses.
  const update = () => {
    const resolved = resolveRetrievalChunking({
      chunkSize: getPref("retrievalChunkSize"),
      overlapSize: getPref("retrievalOverlapSize"),
    });
    overlapInput.max = String(maxOverlapForChunkSize(resolved.chunkSize));
    const messages = describeRetrievalChunking(resolved);
    showAdjustment(chunkInput, chunkWarning, messages.chunkSize);
    showAdjustment(overlapInput, overlapWarning, messages.overlapSize);
    return Boolean(messages.chunkSize || messages.overlapSize);
  };
  const disclosure = findPaneElement<HTMLDetailsElement>(
    doc,
    ids.retrievalAdvanced,
  );
  if (update() && disclosure) disclosure.open = true;
  bindOnce(chunkInput, () => {
    for (const input of [chunkInput, overlapInput]) {
      input.addEventListener("synctopreference", update);
      input.addEventListener("syncfrompreference", update);
    }
  });
}

/** Wires the settings controls that need more than a `preference` binding. */
export function bindPreferencePane(doc: Document) {
  bindChoicePreferences(doc);
  bindSessionHistoryChoice(doc);
  bindRetrievalValidation(doc);
}
