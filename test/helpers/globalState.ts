export function createGlobalStateRestorer(keys: readonly string[]) {
  const snapshot = new Map(
    keys.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(globalThis, key)
        ? (globalThis as Record<string, unknown>)[key]
        : undefined,
    ]),
  );
  const originallyPresent = new Set(
    keys.filter((key) => Object.prototype.hasOwnProperty.call(globalThis, key)),
  );
  return () => {
    for (const key of keys) {
      if (originallyPresent.has(key)) {
        (globalThis as Record<string, unknown>)[key] = snapshot.get(key);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  };
}
