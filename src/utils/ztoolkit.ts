import { BasicTool, ReaderTool, unregister } from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

/**
 * Only the toolkit parts Paper Pilot uses. The aggregate ZoteroToolkit also
 * builds a PromptManager, whose setup installs the toolkit's zotero://plugin
 * and zotero://ztoolkit-debug URL handlers (add-on install and script
 * execution from a link), and FieldHooks and Keyboard managers that patch
 * Zotero.Item and leave reader listeners behind after shutdown.
 */
class PaperPilotToolkit extends BasicTool {
  Reader = new ReaderTool(this);

  unregisterAll() {
    unregister(this);
  }
}

function createZToolkit() {
  const _ztoolkit = new PaperPilotToolkit();
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = __env__ === "production";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  return _ztoolkit;
}
