var PaperPilotResearchWorkspace;

function install() {}

async function startup(data, reason) {
  Services.scriptloader.loadSubScript(
    data.rootURI + "content/scripts/paperpilot-research-workspace.js",
  );
  await PaperPilotResearchWorkspace.startup(data, reason);
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;
  if (PaperPilotResearchWorkspace) {
    await PaperPilotResearchWorkspace.shutdown(data, reason);
  }
}

async function onMainWindowLoad({ window }) {
  PaperPilotResearchWorkspace?.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }) {
  PaperPilotResearchWorkspace?.onMainWindowUnload(window);
}

function uninstall() {}
