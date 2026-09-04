export type ShellExecutor = (
  executable: string,
  args: string[],
) => Promise<unknown>;

export async function launchDetachedShellScript(
  script: string,
  execute: ShellExecutor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await execute("/bin/zsh", ["-lc", script]);
    if (result instanceof Error) {
      return { ok: false, error: result.message };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
