declare const Zotero: any;

export async function stopDetachedRunProcess(
  processId?: string,
): Promise<void> {
  if (!processId || !/^\d+$/.test(processId)) return;
  await Zotero.Utilities.Internal.exec("/bin/zsh", [
    "-lc",
    `kill ${processId} >/dev/null 2>&1 || true`,
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
