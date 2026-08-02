import { classifyRunFailure } from "../ai/runFailure";

export function classifyCodexLoginFailure(
  message: string,
): "login_required" | "unavailable" {
  return classifyRunFailure({
    engine: "codex_cli",
    rawError: message,
    source: "process_exit",
  }).kind === "login_required"
    ? "login_required"
    : "unavailable";
}
