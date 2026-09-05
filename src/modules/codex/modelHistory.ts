import type { EngineMode } from "../ai/types";

export function rememberRecentModel(mode: EngineMode, model: string) {
  const normalized = model.trim();
  if (!normalized) return [];
  const histories = (addon.data.recentModelsByEngine ??= {});
  const current = histories[mode] ?? [];
  const next = [
    normalized,
    ...current.filter((item) => item !== normalized),
  ].slice(0, 3);
  histories[mode] = next;
  return next;
}

export function getRecentModels(mode: EngineMode) {
  return addon.data.recentModelsByEngine?.[mode] ?? [];
}
