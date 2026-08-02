export async function finishRunAfterCleanup(params: {
  prepare: () => void | Promise<void>;
  cleanup: () => unknown | Promise<unknown>;
  complete: () => void | Promise<void>;
  finalize: () => void | Promise<void>;
}): Promise<void> {
  let cleanupAttempted = false;
  try {
    await params.prepare();
    cleanupAttempted = true;
    await params.cleanup();
    await params.complete();
  } finally {
    try {
      if (!cleanupAttempted) {
        cleanupAttempted = true;
        await params.cleanup();
      }
    } finally {
      await params.finalize();
    }
  }
}
