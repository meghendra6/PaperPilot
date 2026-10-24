import { config } from "../../package.json";

/**
 * Gecko caches chrome stylesheets by URL for the whole session. An add-on
 * installed without a restart would keep the previous build's CSS, so each
 * startup of the add-on loads its sheets under a new URL.
 */
const STARTUP_TOKEN = Date.now().toString(36);

export function pluginStylesheetURL(file: string): string {
  return `chrome://${config.addonRef}/content/${file}?v=${STARTUP_TOKEN}`;
}
