export function classifyCodexLoginFailure(
  message: string,
): "login_required" | "unavailable" {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("logged in") ||
    normalized.includes("login required") ||
    normalized.includes("run `codex login`") ||
    normalized.includes("run 'codex login'") ||
    normalized.includes("not logged in") ||
    normalized.includes("authenticate")
  ) {
    return "login_required";
  }

  return "unavailable";
}
