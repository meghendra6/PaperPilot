declare const Zotero: any;

export function buildKillProcessTreeScript(processId: string): string {
  return [
    "kill_run_tree() {",
    '  for child in $(/usr/bin/pgrep -P "$1" 2>/dev/null || true); do',
    '    kill_run_tree "$child"',
    "  done",
    '  kill "$1" >/dev/null 2>&1 || true',
    "}",
    `kill_run_tree ${processId}`,
  ].join("\n");
}

export async function stopDetachedRunProcess(
  processId?: string,
): Promise<void> {
  if (!processId || !/^\d+$/.test(processId)) return;
  await Zotero.Utilities.Internal.exec("/bin/zsh", [
    "-lc",
    buildKillProcessTreeScript(processId),
  ]);
}

export async function finishRunAfterCleanup(params: {
  prepare: () => void | Promise<void>;
  cleanup: () => unknown | Promise<unknown>;
  complete: () => void | Promise<void>;
  incomplete?: (error: unknown) => void | Promise<void>;
  shouldComplete?: () => boolean;
  finalize: () => void | Promise<void>;
}): Promise<void> {
  let failed = false;
  let failure: unknown;

  const captureFailure = (error: unknown) => {
    if (failed) return;
    failed = true;
    failure = error;
  };

  try {
    await params.prepare();
  } catch (error) {
    captureFailure(error);
  }

  try {
    await params.cleanup();
  } catch (error) {
    captureFailure(error);
  }

  if (failed) {
    try {
      await params.incomplete?.(failure);
    } catch (error) {
      captureFailure(error);
    }
  } else if (params.shouldComplete?.() !== false) {
    try {
      await params.complete();
    } catch (error) {
      captureFailure(error);
    }
  }

  try {
    await params.finalize();
  } catch (error) {
    captureFailure(error);
  }

  if (failed) throw failure;
}
