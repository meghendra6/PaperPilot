"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startup = startup;
exports.shutdown = shutdown;
exports.onMainWindowLoad = onMainWindowLoad;
exports.onMainWindowUnload = onMainWindowUnload;
// @ts-nocheck
const agent_1 = __require("src/companion/agent.ts");
const service_1 = __require("src/companion/service.ts");
const platform_1 = __require("src/companion/platform.ts");
const repository_1 = __require("src/modules/researchWorkspace/repository.ts");
const view_1 = __require("src/companion/view.ts");
const ADDON_ID = "paperpilot-research-workspace@meghendra6";
const PANE_ID = "paperpilot-research-workspace-pane";
let registered = false;
let service = null;
function getService() {
    if (service)
        return service;
    const statePath = (0, platform_1.joinPath)((0, platform_1.profileDirectory)(), "paperpilot-research-workspace", "workspace-v3.json");
    const repository = new repository_1.ResearchWorkspaceRepository(statePath, (0, platform_1.createZoteroStorage)());
    service = new service_1.ResearchWorkspaceService({ repository, agent: new agent_1.DirectCliAgent((0, platform_1.createAgentPlatform)()), exportTextFile: platform_1.exportTextFile });
    return service;
}
function register() {
    if (registered || !Zotero.ItemPaneManager?.registerSection)
        return;
    Zotero.ItemPaneManager.registerSection({
        paneID: PANE_ID,
        pluginID: ADDON_ID,
        header: { l10nID: "paperpilot-research-workspace-header", icon: "chrome://paperpilot-research-workspace/content/icon.svg" },
        sidenav: { l10nID: "paperpilot-research-workspace-sidenav", icon: "chrome://paperpilot-research-workspace/content/icon.svg" },
        bodyXHTML: '<html:div xmlns:html="http://www.w3.org/1999/xhtml" class="paperpilot-research-workspace-root" />',
        onItemChange: ({ body, item, tabType }) => {
            body.hidden = tabType !== "reader";
            if (tabType === "reader" && item)
                void (0, view_1.renderResearchWorkspaceView)(body, item, getService());
        },
        onRender: async ({ body, item, tabType }) => {
            body.hidden = tabType !== "reader";
            if (tabType === "reader" && item)
                await (0, view_1.renderResearchWorkspaceView)(body, item, getService());
        },
    });
    registered = true;
}
function unregister() {
    if (!registered)
        return;
    try {
        Zotero.ItemPaneManager.unregisterSection(PANE_ID);
    }
    catch (error) {
        Zotero.logError?.(error);
    }
    registered = false;
}
function onMainWindowLoad(win) {
    const doc = win?.document;
    if (!doc || doc.querySelector('link[data-paperpilot-research-workspace="true"]'))
        return;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "chrome://paperpilot-research-workspace/content/research-workspace.css";
    link.dataset.paperpilotResearchWorkspace = "true";
    doc.documentElement.append(link);
}
function onMainWindowUnload(win) {
    for (const link of win?.document?.querySelectorAll?.('link[data-paperpilot-research-workspace="true"]') || [])
        link.remove();
}
async function startup() {
    if (!globalThis.structuredClone)
        globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
    await Zotero.initializationPromise;
    register();
    for (const win of Zotero.getMainWindows?.() || []) {
        try {
            onMainWindowLoad(win);
        }
        catch (error) {
            Zotero.logError?.(error);
        }
    }
}
async function shutdown() {
    unregister();
    service = null;
    for (const win of Zotero.getMainWindows?.() || [])
        onMainWindowUnload(win);
}
globalThis.PaperPilotResearchWorkspace = { startup, shutdown, onMainWindowLoad, onMainWindowUnload };
