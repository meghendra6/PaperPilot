declare const addon: any;

export function clearClaudePollerForItem(itemID: number) {
  const poller = addon.data.claudeRunPollers?.get(itemID);
  if (poller) {
    clearInterval(poller);
    addon.data.claudeRunPollers?.delete(itemID);
  }
}
