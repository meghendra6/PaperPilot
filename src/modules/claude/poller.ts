declare const addon: any;

export function clearClaudePollerForItem(itemID: number) {
  const poller = addon.data.claudeRunPollers?.get(itemID);
  if (poller) {
    clearInterval(poller);
    addon.data.claudeRunPollers?.delete(itemID);
  }
}

/** Clears `poller` only while it is still the item's registered poller. */
export function clearClaudePollerIfOwned(
  itemID: number,
  poller: ReturnType<typeof setInterval>,
) {
  clearInterval(poller);
  if (addon.data.claudeRunPollers?.get(itemID) === poller)
    addon.data.claudeRunPollers?.delete(itemID);
}
