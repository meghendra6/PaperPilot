import {
  dictionaryRequestURL,
  parseNaverDictionaryResponse,
  type DictionaryLookup,
} from "./dictionaryLookup";

/** Anonymous, bounded request outside the reader's network-blocked document. */
export function requestDictionary(lookup: DictionaryLookup) {
  let cancelled = false;
  let cancelRequest: (() => void) | undefined;
  const result = (async () => {
    const response = await Zotero.HTTP.request(
      "GET",
      dictionaryRequestURL(lookup),
      {
        // Zotero supports anon at runtime; its published typings omit this option.
        ...{ anon: true },
        headers: {
          Accept: "application/json",
          Referer: "https://en.dict.naver.com/",
        },
        followRedirects: false,
        noCache: true,
        timeout: 10_000,
        errorDelayMax: 0,
        successCodes: [200],
        responseType: "text",
        cancellerReceiver: (cancel: () => void) => {
          cancelRequest = cancel;
          if (cancelled) cancel();
        },
        requestObserver: (xhr: XMLHttpRequest) => {
          xhr.addEventListener("progress", (event) => {
            if (event.loaded > 1_000_000) xhr.abort();
          });
        },
      },
    );
    if (cancelled) throw new Error("Dictionary lookup cancelled");
    if (!response.responseText || response.responseText.length > 1_000_000)
      throw new Error("Dictionary response unavailable");
    return parseNaverDictionaryResponse(
      JSON.parse(response.responseText),
      lookup,
    );
  })();
  return {
    result,
    cancel: () => {
      cancelled = true;
      cancelRequest?.();
    },
  };
}
