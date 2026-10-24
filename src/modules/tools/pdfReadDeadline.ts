/** Zotero's add-on sandbox gets DOM cancellation APIs from its main window. */
export function createPDFReadController(): AbortController {
  const runtime = typeof _globalThis !== "undefined" ? _globalThis : globalThis;
  const Constructor =
    runtime.AbortController ||
    (typeof Zotero !== "undefined"
      ? Zotero.getMainWindow?.()?.AbortController
      : undefined) ||
    globalThis.AbortController;
  if (!Constructor)
    throw new Error(
      "PDF reading cancellation support is unavailable. Restart Zotero and try again.",
    );
  return new Constructor();
}

export class PDFReadTimeoutError extends Error {
  constructor(
    readonly stage: string,
    timeoutMs: number,
  ) {
    super(
      `${stage} timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Try reading the PDF again.`,
    );
    this.name = "PDFReadTimeoutError";
  }
}

export function throwIfPDFReadAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("PDF reading canceled.");
  error.name = "AbortError";
  throw error;
}

/** Bound a PDF-read stage without allowing its late result to resume the caller. */
export function waitForPDFRead<T>(
  action: (() => T | PromiseLike<T>) | PromiseLike<T>,
  options: { timeoutMs: number; signal?: AbortSignal; stage: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      done();
    };
    const abort = () => {
      try {
        throwIfPDFReadAborted(options.signal);
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new PDFReadTimeoutError(options.stage, options.timeoutMs)),
        ),
      Math.max(0, options.timeoutMs),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted || options.timeoutMs <= 0) {
      if (typeof action !== "function")
        void Promise.resolve(action).catch(() => {});
      if (options.signal?.aborted) abort();
      else
        finish(() =>
          reject(new PDFReadTimeoutError(options.stage, options.timeoutMs)),
        );
      return;
    }
    Promise.resolve()
      .then(() => {
        throwIfPDFReadAborted(options.signal);
        if (settled)
          throw new PDFReadTimeoutError(options.stage, options.timeoutMs);
        return typeof action === "function" ? action() : action;
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}
