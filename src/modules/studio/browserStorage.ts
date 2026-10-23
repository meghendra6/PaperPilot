// SuperDoc's bundled Vue devtools reads localStorage during module evaluation.
// An opaque sandbox deliberately has no origin storage. Give those UI settings
// a window-lifetime store; document durability belongs exclusively to the host.
const settings = new Map<string, string>();
export const localStorage = {
  get length() {
    return settings.size;
  },
  clear() {
    settings.clear();
  },
  getItem(key: string) {
    return settings.get(String(key)) ?? null;
  },
  key(index: number) {
    return [...settings.keys()][index] ?? null;
  },
  removeItem(key: string) {
    settings.delete(String(key));
  },
  setItem(key: string, value: string) {
    settings.set(String(key), String(value));
  },
};
