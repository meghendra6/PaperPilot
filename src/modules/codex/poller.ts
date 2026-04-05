export function clearCodexPollerForItem(itemID: number) {
  const poller = addon.data.codexRunPollers?.get(itemID);
  if (poller) {
    clearInterval(poller);
    addon.data.codexRunPollers?.delete(itemID);
  }
}
