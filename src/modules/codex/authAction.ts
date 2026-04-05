import type { CodexLoginState } from "./status";

export function buildCodexAuthenticateMessage(
  loginState: CodexLoginState,
  lastProbeError?: string,
) {
  switch (loginState) {
    case "ready":
      return "Codex CLI is already authenticated. You can start a Codex run now or click Re-check status to refresh diagnostics.";
    case "login_required":
      return "Codex CLI still needs authentication. Run `codex login` in your terminal, complete any browser/device flow, and then click Re-check status.";
    case "unavailable": {
      const detail = String(lastProbeError || "").trim();
      return detail
        ? `Codex CLI is unavailable: ${detail}`
        : "Codex CLI is unavailable. Check the configured executable path and diagnostics, then click Re-check status.";
    }
    case "not_checked":
    default:
      return "Codex CLI status was not checked yet. Click Re-check status to refresh diagnostics.";
  }
}
