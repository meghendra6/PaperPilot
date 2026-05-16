import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export function checkShellSyntax(script: string) {
  const shell = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";

  return spawnSync(shell, ["-n"], {
    input: script,
    encoding: "utf8",
  });
}
