import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { registerPaperPilotPaneSection } from "./modules/readerPane";
import { clearCodexPollerForItem } from "./modules/codex/poller";
import {
  registerReaderActionPlaceholders,
  unregisterReaderActionPlaceholders,
} from "./modules/readerActions";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPreferencePane();
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

function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: `${rootURI}chrome/content/preferences.xhtml`,
    label: getString("prefs-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}

function onShutdown(): void {
  addon.data.codexRunPollers?.forEach((_poller, itemID) =>
    clearCodexPollerForItem(itemID),
  );
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
