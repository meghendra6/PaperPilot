import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { normalizeResponseLanguage } from "./translation/responseLanguage";

const PLACEHOLDER_PREF_NOTICE =
  "Placeholder preference saved. This settings surface does not wire live provider or retrieval behavior yet.";

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/chrome/content/preferences.xul onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [
        {
          dataKey: "title",
          label: getString("prefs-table-title"),
          fixedWidth: true,
          width: 100,
        },
        {
          dataKey: "detail",
          label: getString("prefs-table-detail"),
        },
      ],
      rows: [],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  syncResponseLanguagePreference(_window.document);
  bindPrefEvents();
}

function syncResponseLanguagePreference(doc: Document) {
  const select = doc.querySelector<HTMLSelectElement>(
    "#zotero-prefpane-__addonRef__-input-response-language",
  );
  const normalized = normalizeResponseLanguage(getPref("responseLanguage"));
  if (getPref("responseLanguage") !== normalized) {
    setPref("responseLanguage", normalized);
  }
  if (select) {
    select.value = normalized;
    if (select.dataset.prefBound === "true") {
      return;
    }
    select.dataset.prefBound = "true";
    select.addEventListener("change", () => {
      setPref("responseLanguage", normalizeResponseLanguage(select.value));
    });
  }
}

function bindPrefEvents() {
  const prefInputs =
    addon.data.prefs?.window.document.querySelectorAll<HTMLInputElement>(
      "[data-placeholder-pref='true']",
    );

  prefInputs?.forEach((input) => {
    if (input.dataset.prefBound === "true") {
      return;
    }

    input.dataset.prefBound = "true";
    input.addEventListener("change", () => {
      addon.data.prefs?.window.alert(PLACEHOLDER_PREF_NOTICE);
    });
  });
}
