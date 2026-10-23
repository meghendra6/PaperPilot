/**
 * Item-keyed pane bridges (reader actions, notices, capability activation)
 * are last-render-wins: the newest pane for a paper owns the entry. Two
 * reader tabs can show the same paper, so when the newest one goes away the
 * previous still-mounted pane must take the entry back instead of leaving
 * the paper with no bridge at all.
 */
const registrations = new WeakMap<
  Map<number, unknown>,
  Map<number, unknown[]>
>();

export function registerItemBridge<T>(
  bridges: Map<number, T> | undefined,
  itemID: number,
  value: T,
): () => void {
  if (!bridges) return () => undefined;
  let byItem = registrations.get(bridges as Map<number, unknown>);
  if (!byItem) {
    byItem = new Map();
    registrations.set(bridges as Map<number, unknown>, byItem);
  }
  const stack = byItem.get(itemID) ?? [];
  stack.push(value);
  byItem.set(itemID, stack);
  bridges.set(itemID, value);

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const current = byItem.get(itemID) ?? [];
    const remaining = current.filter((entry) => entry !== value);
    if (remaining.length) byItem.set(itemID, remaining);
    else byItem.delete(itemID);
    if (bridges.get(itemID) !== value) return;
    if (remaining.length) bridges.set(itemID, remaining.at(-1) as T);
    else bridges.delete(itemID);
  };
}
