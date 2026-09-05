import * as profiles_1 from "./profiles";
function detectCriticalReadProfile(text: string) {
  const normalized = String(text || "").toLowerCase();
  const scores: Record<string, number> = {};
  const hits: Record<string, string[]> = {};
  for (const profile of (0, profiles_1.listCriticalReadProfiles)()) {
    if (profile.id === "general") {
      scores[profile.id] = 0.05;
      hits[profile.id] = [];
      continue;
    }
    const matched = profile.signals.filter((signal) =>
      normalized.includes(signal.toLowerCase()),
    );
    hits[profile.id] = matched;
    scores[profile.id] = matched.reduce(
      (sum, signal) => sum + Math.min(2.2, 0.65 + signal.length / 14),
      0,
    );
  }
  const ordered = Object.entries(scores).sort(
    (left, right) => right[1] - left[1],
  );
  const primary = ordered[0][1] > 0.6 ? ordered[0][0] : "general";
  const secondary =
    ordered[1] && ordered[1][1] >= ordered[0][1] * 0.55 && ordered[1][1] > 0.8
      ? ordered[1][0]
      : undefined;
  const total = ordered.reduce((sum, entry) => sum + Math.max(0, entry[1]), 0);
  const confidence =
    primary === "general"
      ? 0.35
      : Math.max(
          0.45,
          Math.min(0.98, scores[primary] / Math.max(1, total) + 0.42),
        );
  return {
    primary,
    ...(secondary && secondary !== "general" ? { secondary } : {}),
    confidence,
    scores,
    reasons: hits[primary]
      .slice(0, 8)
      .map((signal) => `Matched signal: ${signal}`),
  };
}

export { detectCriticalReadProfile };
