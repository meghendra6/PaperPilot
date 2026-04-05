import type { ProviderStatus } from "./types";

export function getStatusLabel(status: ProviderStatus | string) {
  switch (status) {
    case "ready":
      return "Ready";
    case "login_required":
      return "Login required";
    case "checking":
      return "Preparing context";
    case "placeholder":
      return "Fallback";
    case "unsupported":
      return "Error";
    case "running":
      return "Running";
    case "completed":
      return "Ready";
    case "error":
      return "Error";
    default:
      return String(status);
  }
}
