/* eslint-disable no-undef */

// General
pref("__prefsPrefix__.defaultMode", "codex_cli");
pref("__prefsPrefix__.autoOpenPaneOnPdfOpen", false);
pref("__prefsPrefix__.saveDocumentSessions", true);
pref("__prefsPrefix__.responseLanguage", "English");

// Gemini CLI
pref("__prefsPrefix__.geminiExecutablePath", "");
pref("__prefsPrefix__.geminiDefaultModel", "gemini-3.1-pro");
pref(
  "__prefsPrefix__.geminiAllowedModels",
  "gemini-3.1-pro, gemini-3-flash",
);

// Codex CLI
pref("__prefsPrefix__.codexExecutablePath", "");
pref("__prefsPrefix__.codexDefaultModel", "gpt-5-codex");
pref("__prefsPrefix__.codexReasoningEffort", "medium");
pref("__prefsPrefix__.codexAllowedModels", "gpt-5-codex");
pref("__prefsPrefix__.codexEnableWebSearch", true);
pref("__prefsPrefix__.codexSandboxMode", "workspace-write");
pref("__prefsPrefix__.codexApprovalMode", "never");
pref("__prefsPrefix__.codexWorkspaceRoot", "");
pref("__prefsPrefix__.codexAutoCleanWorkspace", true);

// Retrieval
pref("__prefsPrefix__.retrievalChunkSize", 1200);
pref("__prefsPrefix__.retrievalOverlapSize", 200);
pref("__prefsPrefix__.retrievalTopK", 6);
pref("__prefsPrefix__.retrievalIncludeAbstract", true);
pref("__prefsPrefix__.retrievalIncludeNearbyContext", true);

// Privacy
pref("__prefsPrefix__.privacyStoreLocalHistory", true);
pref("__prefsPrefix__.privacySavePromptsOnly", false);
pref("__prefsPrefix__.privacySaveResponses", true);
pref("__prefsPrefix__.privacyRedactLocalFilePaths", true);
