import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import {
  disposeReaderPaneRunProgressCards,
  registerPaperPilotPaneSection,
} from "./modules/readerPane";
import { clearClaudePollerForItem } from "./modules/claude/poller";
import { clearCodexPollerForItem } from "./modules/codex/poller";
import { clearGeminiPollerForItem } from "./modules/gemini/poller";
import {
  registerReaderActionPlaceholders,
  unregisterReaderActionPlaceholders,
} from "./modules/readerActions";
import { PAPER_PILOT_PREF_PANE_ID } from "./modules/ui/runProgressCard";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  await registerPreferencePane();
  registerPaperPilotPaneSection();
  registerReaderActionPlaceholders();
  await Promise.all(Zotero.getMainWindows().map(onMainWindowLoad));
}

async function onMainWindowLoad(win: Window) {
  await Promise.resolve();
  // Ensure Fluent resources are attached for main-window UI strings
  (win as any).MozXULElement?.insertFTLIfNeeded?.(
    `${config.addonRef}-mainWindow.ftl`,
  );

  // Load plugin stylesheet into the main window
  const cssID = `${config.addonRef}-stylesheet`;
  if (!win.document.getElementById(cssID)) {
    const link = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "link",
    ) as HTMLLinkElement;
    link.id = cssID;
    link.rel = "stylesheet";
    link.href = `chrome://${config.addonRef}/content/zoteroPane.css`;
    win.document.documentElement.appendChild(link);
  }

  // Recreate toolkit bound to the active window context
  addon.data.ztoolkit = createZToolkit();
  registerPaperPilotPaneSection();
}

async function registerPreferencePane() {
  await Zotero.PreferencePanes.register({
    id: PAPER_PILOT_PREF_PANE_ID,
    pluginID: config.addonID,
    src: `${rootURI}chrome/content/preferences.xhtml`,
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}

function onShutdown(): void {
  disposeReaderPaneRunProgressCards();
  addon.data.codexRunPollers?.forEach((_poller, itemID) =>
    clearCodexPollerForItem(itemID),
  );
  addon.data.claudeRunPollers?.forEach((_poller, itemID) =>
    clearClaudePollerForItem(itemID),
  );
  addon.data.geminiRunPollers?.forEach((_poller, itemID) =>
    clearGeminiPollerForItem(itemID),
  );
  addon.data.pendingEngineCompletions?.forEach((pending) =>
    pending.cancelTimeout?.(),
  );
  addon.data.pendingEngineCompletions?.clear();
  addon.data.runProgressStates?.clear();
  unregisterReaderActionPlaceholders();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove plugin stylesheet from all windows
  for (const win of Zotero.getMainWindows()) {
    win.document.getElementById(`${config.addonRef}-stylesheet`)?.remove();
  }
  // Remove addon object
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onNotify,
  onPrefsEvent,
};
