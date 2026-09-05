import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { normalizeResponseLanguage } from "./translation/responseLanguage";

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
}

function syncResponseLanguagePreference(doc: Document) {
  const select = doc.querySelector<HTMLSelectElement>(
    `#zotero-prefpane-${config.addonRef}-input-response-language`,
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
