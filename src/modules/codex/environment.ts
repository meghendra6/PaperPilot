import {
  buildCliCommandEnvironment,
  resolveCliUserHome,
} from "../ai/cliEnvironment";

export function resolveCodexUserHome(profilePath?: string) {
  return resolveCliUserHome(profilePath);
}

export function buildCodexCommandEnvironment(
  executablePath: string,
  profilePath?: string,
) {
  return buildCliCommandEnvironment(executablePath, profilePath);
}
