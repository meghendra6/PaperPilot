export function rememberRecentCodexModel(model: string) {
  const normalized = model.trim();
  if (!normalized) {
    return [];
  }

  const current = addon.data.recentCodexModels ?? [];
  const next = [
    normalized,
    ...current.filter((item) => item !== normalized),
  ].slice(0, 3);
  addon.data.recentCodexModels = next;
  return next;
}

export function getRecentCodexModels() {
  return addon.data.recentCodexModels ?? [];
}
