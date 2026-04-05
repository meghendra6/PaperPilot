function shellEscape(value: string) {
  return `'${value.replace(/'/g, `"'"'"`)}'`;
}

function buildShellEnvironmentExports(
  environment?: Record<string, string | undefined>,
) {
  if (!environment) {
    return [];
  }

  return Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
}

export function buildCodexShellScript(params: {
  promptPath: string;
  outputPath: string;
  command: string[];
  environment?: Record<string, string | undefined>;
}) {
  const command = params.command.map(shellEscape).join(" ");
  return [
    `mkdir -p ${shellEscape(params.outputPath.replace(/\/[^/]+$/, ""))}`,
    ...buildShellEnvironmentExports(params.environment),
    `cat ${shellEscape(params.promptPath)} | ${command} > ${shellEscape(params.outputPath)}`,
  ].join(" && ");
}

export function buildBackgroundCodexShellScript(params: {
  promptPath: string;
  outputPath: string;
  exitCodePath: string;
  pidPath: string;
  command: string[];
  environment?: Record<string, string | undefined>;
}) {
  const command = params.command.map(shellEscape).join(" ");
  const outputDir = params.outputPath.replace(/\/[^/]+$/, "");
  return [
    `mkdir -p ${shellEscape(outputDir)}`,
    `rm -f ${shellEscape(params.outputPath)} ${shellEscape(params.exitCodePath)} ${shellEscape(params.pidPath)}`,
    ...buildShellEnvironmentExports(params.environment),
    `(` +
      `cat ${shellEscape(params.promptPath)} | ${command} > ${shellEscape(params.outputPath)} 2>&1; ` +
      `printf '%s' $? > ${shellEscape(params.exitCodePath)}` +
      `) & echo $! > ${shellEscape(params.pidPath)}`,
  ].join(" && ");
}
