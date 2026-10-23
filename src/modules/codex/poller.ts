declare const addon: any;

export function clearCodexPollerForItem(itemID: number) {
  const poller = addon.data.codexRunPollers?.get(itemID);
  if (poller) {
    clearInterval(poller);
    addon.data.codexRunPollers?.delete(itemID);
  }
}

/** Clears `poller` only while it is still the item's registered poller. */
export function clearCodexPollerIfOwned(
  itemID: number,
  poller: ReturnType<typeof setInterval>,
) {
  clearInterval(poller);
  if (addon.data.codexRunPollers?.get(itemID) === poller)
    addon.data.codexRunPollers?.delete(itemID);
}
