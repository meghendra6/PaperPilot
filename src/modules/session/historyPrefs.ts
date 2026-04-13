import { getPref } from "../../utils/prefs";
import type { SessionHistoryPrefsResolution } from "./historyTypes";

const DISABLED_HISTORY_PREFS: SessionHistoryPrefsResolution = {
  mode: "disabled",
  persistHistory: false,
  persistAssistantMessages: false,
  persistAssistantDerivedState: false,
};

const PROMPTS_ONLY_HISTORY_PREFS: SessionHistoryPrefsResolution = {
  mode: "prompts-only",
  persistHistory: true,
  persistAssistantMessages: false,
  persistAssistantDerivedState: false,
};

const FULL_HISTORY_PREFS: SessionHistoryPrefsResolution = {
  mode: "full",
  persistHistory: true,
  persistAssistantMessages: true,
  persistAssistantDerivedState: true,
};

export function resolveSessionHistoryPrefs(): SessionHistoryPrefsResolution {
  if (!Boolean(getPref("saveDocumentSessions"))) {
    return DISABLED_HISTORY_PREFS;
  }

  if (!Boolean(getPref("privacyStoreLocalHistory"))) {
    return DISABLED_HISTORY_PREFS;
  }

  if (Boolean(getPref("privacySavePromptsOnly"))) {
    return PROMPTS_ONLY_HISTORY_PREFS;
  }

  if (!Boolean(getPref("privacySaveResponses"))) {
    return PROMPTS_ONLY_HISTORY_PREFS;
  }

  return FULL_HISTORY_PREFS;
}
