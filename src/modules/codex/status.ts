import { getPref } from "../../utils/prefs";
import { probeCodexExecutable, resolveCodexExecutablePath } from "./executable";
import { classifyCodexLoginFailure } from "./statusClassification";

export type CodexLoginState =
  | "ready"
  | "login_required"
  | "unavailable"
  | "not_checked";

export async function probeCodexLoginState(): Promise<CodexLoginState> {
  const executablePath = await resolveCodexExecutablePath(
    String(getPref("codexExecutablePath") || ""),
  );
  const probe = await probeCodexExecutable(executablePath);

  addon.data.codexExecutableResolvedPath = probe.path;
  addon.data.codexLastProbeError = undefined;

  if (probe.loginOk) {
    return "ready";
  }

  const failure = probe.loginStatus || "Codex CLI login probe failed.";
  addon.data.codexLastProbeError = failure;

  if (probe.versionOk) {
    return classifyCodexLoginFailure(failure);
  }

  return "unavailable";
}
