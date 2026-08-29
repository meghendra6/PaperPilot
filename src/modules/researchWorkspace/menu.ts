import { config } from "../../../package.json";
import { getLocaleID } from "../../utils/locale";
import { openResearchWorkspace } from "./window";
import type { ResearchWorkspaceLaunchOrigin } from "./selectionSnapshot";

declare const Zotero: any;

const TOOLS_MENU_ID = "paperpilot-research-workspace-tools-menu";
const ITEM_MENU_ID = "paperpilot-research-workspace-item-menu";
const FALLBACK_TOOLS_ID = `${TOOLS_MENU_ID}-fallback`;
const FALLBACK_ITEM_ID = `${ITEM_MENU_ID}-fallback`;
const FALLBACK_LABEL = "Open Research Workspace…";

const registeredMenuIDs: string[] = [];
let registrationAttempted = false;
let managedToolsMenu = false;
let managedItemMenu = false;

function report(error: unknown) {
  Zotero.logError?.(error);
}

function launch(
  items: readonly any[] | undefined,
  origin: ResearchWorkspaceLaunchOrigin,
) {
  void openResearchWorkspace({ items, origin }).catch(report);
}

function registerManagedMenus() {
  if (registrationAttempted) return;
  const manager = Zotero.MenuManager;
  if (!manager?.registerMenu) return;
  registrationAttempted = true;

  try {
    const tools = manager.registerMenu({
      menuID: TOOLS_MENU_ID,
      pluginID: config.addonID,
      target: "main/menubar/tools",
      menus: [
        {
          menuType: "menuitem",
          l10nID: getLocaleID("research-workspace-open-menuitem"),
          onShowing: (
            _event: Event,
            context: { setEnabled: (enabled: boolean) => void },
          ) => context.setEnabled(true),
          onCommand: (_event: Event, context: { items?: any[] }) =>
            launch(context.items, "tools-menu"),
        },
      ],
    });
    if (typeof tools === "string") {
      registeredMenuIDs.push(tools);
      managedToolsMenu = true;
    }
  } catch (error) {
    report(error);
  }

  try {
    const item = manager.registerMenu({
      menuID: ITEM_MENU_ID,
      pluginID: config.addonID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: getLocaleID("research-workspace-open-menuitem"),
          onShowing: (
            _event: Event,
            context: {
              setEnabled: (enabled: boolean) => void;
              setVisible: (visible: boolean) => void;
            },
          ) => {
            context.setVisible(true);
            context.setEnabled(true);
          },
          onCommand: (_event: Event, context: { items?: any[] }) =>
            launch(context.items, "item-context-menu"),
        },
      ],
    });
    if (typeof item === "string") {
      registeredMenuIDs.push(item);
      managedItemMenu = true;
    }
  } catch (error) {
    report(error);
  }
}

function appendFallbackMenuItem(params: {
  win: Window;
  popupID: string;
  itemID: string;
  origin: ResearchWorkspaceLaunchOrigin;
}) {
  const doc = params.win.document;
  if (doc.getElementById(params.itemID)) return;
  const popup = doc.getElementById(params.popupID);
  if (!popup) return;
  const menuItem = (doc as any).createXULElement
    ? (doc as any).createXULElement("menuitem")
    : doc.createElement("menuitem");
  menuItem.id = params.itemID;
  menuItem.setAttribute("label", FALLBACK_LABEL);
  menuItem.addEventListener("command", () => launch(undefined, params.origin));
  popup.appendChild(menuItem);
}

function syncFallbackMenus(win: Window) {
  if (managedToolsMenu) {
    win.document.getElementById(FALLBACK_TOOLS_ID)?.remove();
  } else {
    appendFallbackMenuItem({
      win,
      popupID: "menu_ToolsPopup",
      itemID: FALLBACK_TOOLS_ID,
      origin: "tools-menu",
    });
  }
  if (managedItemMenu) {
    win.document.getElementById(FALLBACK_ITEM_ID)?.remove();
  } else {
    appendFallbackMenuItem({
      win,
      popupID: "zotero-itemmenu",
      itemID: FALLBACK_ITEM_ID,
      origin: "item-context-menu",
    });
  }
}

export function registerResearchWorkspaceLaunchers(win?: Window) {
  registerManagedMenus();
  if (win) syncFallbackMenus(win);
  else
    for (const mainWindow of Zotero.getMainWindows?.() ?? []) {
      syncFallbackMenus(mainWindow);
    }
}

export function unregisterResearchWorkspaceLaunchersForWindow(win: Window) {
  win.document.getElementById(FALLBACK_TOOLS_ID)?.remove();
  win.document.getElementById(FALLBACK_ITEM_ID)?.remove();
}

export function unregisterResearchWorkspaceLaunchers() {
  for (const menuID of registeredMenuIDs.splice(0)) {
    try {
      Zotero.MenuManager?.unregisterMenu?.(menuID);
    } catch (error) {
      report(error);
    }
  }
  for (const win of Zotero.getMainWindows?.() ?? []) {
    unregisterResearchWorkspaceLaunchersForWindow(win);
  }
  registrationAttempted = false;
  managedToolsMenu = false;
  managedItemMenu = false;
}
