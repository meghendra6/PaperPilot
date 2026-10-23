export function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * One `export` line for a run's environment. PATH keeps the fixed CLI
 * directories first and then the login shell's own PATH, so a CLI or Java
 * that the login shell (and the doctor script) finds is still found.
 */
export function shellExportLine(key: string, value: string) {
  return key === "PATH"
    ? `export PATH=${shellEscape(value)}:"$PATH"`
    : `export ${key}=${shellEscape(value)}`;
}

function buildShellEnvironmentExports(
  environment?: Record<string, string | undefined>,
) {
  if (!environment) {
    return [];
  }

  return Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .map(([key, value]) => shellExportLine(key, value));
}

/**
 * Records the CLI's exit status after it ends. The agent can plant a link at
 * the exit-file path during the run, so the writer removes whatever is there
 * and refuses to overwrite with noclobber instead of following the link.
 */
export function exitCodeWriter(exitCodePath: string) {
  const path = shellEscape(exitCodePath);
  return `pp_status=$?; rm -f -- ${path}; set -C; printf '%s' "$pp_status" > ${path}`;
}

export function buildBackgroundCodexShellScript(params: {
  promptPath: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  command: string[];
  environment?: Record<string, string | undefined>;
}) {
  const command = params.command.map(shellEscape).join(" ");
  const outputDir = params.outputPath.replace(/\/[^/]+$/, "");
  return [
    `mkdir -p ${shellEscape(outputDir)}`,
    `rm -f ${shellEscape(params.outputPath)} ${shellEscape(params.stderrPath)} ${shellEscape(params.exitCodePath)} ${shellEscape(params.pidPath)}`,
    ...buildShellEnvironmentExports(params.environment),
    `(` +
      `cat ${shellEscape(params.promptPath)} | ${command} > ${shellEscape(params.outputPath)} 2> ${shellEscape(params.stderrPath)}; ` +
      exitCodeWriter(params.exitCodePath) +
      `) & echo $! > ${shellEscape(params.pidPath)}`,
  ].join(" && ");
}
