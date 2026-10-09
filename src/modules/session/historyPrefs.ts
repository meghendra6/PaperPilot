import { getPref } from "../../utils/prefs";
import type {
  SessionHistoryPersistenceMode,
  SessionHistoryPrefsResolution,
} from "./historyTypes";

/** The four stored checkboxes that together select one history outcome. */
export const SESSION_HISTORY_PREF_KEYS = [
  "saveDocumentSessions",
  "privacyStoreLocalHistory",
  "privacySavePromptsOnly",
  "privacySaveResponses",
] as const;

export type SessionHistoryPrefKey = (typeof SESSION_HISTORY_PREF_KEYS)[number];

type ReadHistoryPref = (key: SessionHistoryPrefKey) => unknown;

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

export function resolveSessionHistoryPrefs(
  read: ReadHistoryPref = getPref,
): SessionHistoryPrefsResolution {
  if (!read("saveDocumentSessions")) {
    return DISABLED_HISTORY_PREFS;
  }

  if (!read("privacyStoreLocalHistory")) {
    return DISABLED_HISTORY_PREFS;
  }

  if (read("privacySavePromptsOnly")) {
    return PROMPTS_ONLY_HISTORY_PREFS;
  }

  if (!read("privacySaveResponses")) {
    return PROMPTS_ONLY_HISTORY_PREFS;
  }

  return FULL_HISTORY_PREFS;
}

export function isSessionHistoryMode(
  value: unknown,
): value is SessionHistoryPersistenceMode {
  return value === "disabled" || value === "prompts-only" || value === "full";
}

/**
 * Preference writes that make resolveSessionHistoryPrefs() return `mode`.
 * The settings pane uses one choice for the outcome and keeps the four
 * stored preferences, so saved values and their meaning stay unchanged.
 */
export function sessionHistoryPrefWrites(
  mode: SessionHistoryPersistenceMode,
): ReadonlyArray<readonly [SessionHistoryPrefKey, boolean]> {
  switch (mode) {
    case "disabled":
      return [
        ["saveDocumentSessions", false],
        ["privacyStoreLocalHistory", false],
      ];
    case "prompts-only":
      return [
        ["saveDocumentSessions", true],
        ["privacyStoreLocalHistory", true],
        ["privacySavePromptsOnly", true],
        ["privacySaveResponses", false],
      ];
    case "full":
      return [
        ["saveDocumentSessions", true],
        ["privacyStoreLocalHistory", true],
        ["privacySavePromptsOnly", false],
        ["privacySaveResponses", true],
      ];
  }
}
