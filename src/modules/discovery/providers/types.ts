import type {
  DiscoveredPaper,
  DiscoveryProviderCandidate,
  PublicationEvidence,
} from "../types";

declare const _globalThis: typeof globalThis | undefined;
declare const Zotero:
  | {
      getMainWindow?: () => Window & {
        AbortController?: typeof AbortController;
      };
    }
  | undefined;

export type DiscoveryFetch = typeof fetch;

export function createDiscoveryAbortController(): AbortController {
  const runtimeGlobal =
    typeof _globalThis !== "undefined" ? _globalThis : globalThis;
  const Constructor = (runtimeGlobal.AbortController ||
    (typeof Zotero !== "undefined"
      ? Zotero.getMainWindow?.()?.AbortController
      : undefined) ||
    globalThis.AbortController) as typeof AbortController | undefined;
  if (!Constructor) {
    throw new Error("Discovery cancellation support is unavailable.");
  }
  return new Constructor();
}

export function withDiscoveryFetchTimeout(
  fetcher: DiscoveryFetch = fetch,
  timeoutMs = 15_000,
  outerSignal?: AbortSignal,
): DiscoveryFetch {
  return (async (input, init = {}) => {
    const controller = createDiscoveryAbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Discovery request timed out.")),
      timeoutMs,
    );
    const sourceSignal = init.signal;
    const abortFromSource = () =>
      controller.abort(sourceSignal?.reason || new Error("Request cancelled."));
    const abortFromOuter = () =>
      controller.abort(outerSignal?.reason || new Error("Request cancelled."));
    sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
    outerSignal?.addEventListener("abort", abortFromOuter, { once: true });
    if (sourceSignal?.aborted) abortFromSource();
    if (outerSignal?.aborted) abortFromOuter();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      sourceSignal?.removeEventListener("abort", abortFromSource);
      outerSignal?.removeEventListener("abort", abortFromOuter);
    };
    try {
      const response = await fetcher(input, {
        ...init,
        signal: controller.signal,
      });
      if (!response.body || typeof response.body.getReader !== "function") {
        cleanup();
        return response;
      }

      const reader = response.body.getReader();
      let terminated = false;
      const terminate = () => {
        if (terminated) return;
        terminated = true;
        cleanup();
      };
      const body = new ReadableStream({
        start(streamController) {
          controller.signal.addEventListener(
            "abort",
            () => {
              if (terminated) return;
              terminate();
              void reader
                .cancel(controller.signal.reason)
                .catch(() => undefined);
              streamController.error(
                controller.signal.reason || new Error("Request cancelled."),
              );
            },
            { once: true },
          );
        },
        async pull(streamController) {
          try {
            const { value, done } = await reader.read();
            if (terminated) return;
            if (done) {
              terminate();
              streamController.close();
            } else {
              streamController.enqueue(value);
            }
          } catch (error) {
            if (terminated) return;
            terminate();
            streamController.error(error);
          }
        },
        async cancel(reason) {
          terminate();
          await reader.cancel(reason).catch(() => undefined);
        },
      });
      const wrapped = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      for (const property of ["url", "redirected", "type"] as const) {
        try {
          Object.defineProperty(wrapped, property, {
            configurable: true,
            value: response[property],
          });
        } catch {
          // These response metadata fields are best-effort in test shims.
        }
      }
      const connectionAddress = (
        response as Response & {
          remoteAddress?: string;
        }
      ).remoteAddress;
      if (connectionAddress) {
        Object.defineProperty(wrapped, "remoteAddress", {
          configurable: true,
          value: connectionAddress,
        });
      }
      return wrapped;
    } catch (error) {
      cleanup();
      throw error;
    }
  }) as DiscoveryFetch;
}

export interface CandidateSearchProvider {
  id: string;
  search(
    query: string,
    options?: { limit?: number; fetch?: DiscoveryFetch },
  ): Promise<DiscoveryProviderCandidate[]>;
}

export interface PublicationEvidenceProvider {
  id: string;
  canHandle(candidate: DiscoveredPaper): boolean;
  collect(
    candidate: DiscoveredPaper,
    options?: { fetch?: DiscoveryFetch },
  ): Promise<PublicationEvidence[]>;
}
