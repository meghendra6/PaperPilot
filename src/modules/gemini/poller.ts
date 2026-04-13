declare const addon: any;

export function clearGeminiPollerForItem(itemID: number) {
  const poller = addon.data.geminiRunPollers?.get(itemID);
  if (poller) {
    clearInterval(poller);
    addon.data.geminiRunPollers?.delete(itemID);
  }
}
