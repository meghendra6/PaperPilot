import { getPref } from "../../utils/prefs";
import { probeCodexExecutable, resolveCodexExecutablePath } from "./executable";

export async function collectCodexDiagnostics() {
  const configuredPath = String(getPref("codexExecutablePath") || "");
  const resolvedPath = await resolveCodexExecutablePath(configuredPath);
  const resolvedProbe = await probeCodexExecutable(resolvedPath);
  const candidateLines =
    addon.data.codexExecutableCandidates?.map(
      (candidate) =>
        `- ${candidate.path} [${candidate.source}] version=${candidate.version || "ERR"} login=${candidate.loginOk ? "OK" : candidate.loginStatus || "ERR"}`,
    ) || [];

  return [
    `CONFIGURED_PATH=${configuredPath || "(auto-detect)"}`,
    `RESOLVED_PATH=${resolvedPath}`,
    `RESOLVED_VERSION=${resolvedProbe.version || "ERROR"}`,
    `RESOLVED_LOGIN_STATUS=${resolvedProbe.loginOk ? resolvedProbe.loginStatus || "OK" : resolvedProbe.loginStatus || "ERROR"}`,
    "CANDIDATES:",
    ...(candidateLines.length ? candidateLines : ["- none"]),
  ].join("\n");
}
