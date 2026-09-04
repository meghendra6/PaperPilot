import { config } from "../../package.json";

declare const Zotero: any;

type PaperPilotPreferenceMap = _ZoteroTypes.Prefs["PluginPrefsMap"];
export type PaperPilotPreferenceKey = Extract<
  keyof PaperPilotPreferenceMap,
  string
>;

/**
 * Get preference value.
 * Wrapper of `Zotero.Prefs.get`.
 * @param key
 */
export function getPref<Key extends PaperPilotPreferenceKey>(key: Key) {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true) as
    | PaperPilotPreferenceMap[Key]
    | undefined;
}

/**
 * Set preference value.
 * Wrapper of `Zotero.Prefs.set`.
 * @param key
 * @param value
 */
export function setPref<Key extends PaperPilotPreferenceKey>(
  key: Key,
  value: PaperPilotPreferenceMap[Key],
) {
  return Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
}

/**
 * Clear preference value.
 * Wrapper of `Zotero.Prefs.clear`.
 * @param key
 */
export function clearPref<Key extends PaperPilotPreferenceKey>(key: Key) {
  return Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
}
