/**
 * Zotero.Utilities.Internal.subprocess returns only stdout and ignores the
 * exit status, so a probe cannot tell success from failure by itself. These
 * helpers merge stderr into stdout and print the exit status as a final
 * marker line that the caller parses.
 */
const EXIT_MARKER = "__PAPERPILOT_EXIT__=";

export interface SubprocessStatusResult {
  /** Undefined when the marker is missing, for example after a crash. */
  exitCode: number | undefined;
  /** Combined stdout and stderr without the marker line. */
  output: string;
}

export function withExitStatusMarker(script: string): string {
  // A subshell keeps an `exit` inside the script from skipping the marker.
  return `( ${script} ) 2>&1; printf '\\n${EXIT_MARKER}%s\\n' "$?"`;
}

export function parseExitStatusMarker(raw: string): SubprocessStatusResult {
  const text = String(raw || "");
  const index = text.lastIndexOf(EXIT_MARKER);
  if (index < 0) return { exitCode: undefined, output: text };
  const code = Number.parseInt(
    text.slice(index + EXIT_MARKER.length).trim(),
    10,
  );
  return {
    exitCode: Number.isInteger(code) ? code : undefined,
    output: text.slice(0, index).replace(/\n$/, ""),
  };
}
