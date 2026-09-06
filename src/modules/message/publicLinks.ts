/** No fetch or privileged scheme; activation is always an explicit user action. */
export function safePublicURL(value: string): string | undefined {
  if (
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    const host = url.hostname.toLowerCase();
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
        host,
      ) ||
      /^\[(?:::|::1|f[cd][0-9a-f:]*)\]$/.test(host)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function openPublicURL(value: string, doc?: Document) {
  const url = safePublicURL(value);
  if (!url) throw new Error("This source link is not an allowed public URL.");
  const zotero = (
    globalThis as typeof globalThis & {
      Zotero?: { launchURL?: (url: string) => void };
    }
  ).Zotero;
  if (zotero?.launchURL) zotero.launchURL(url);
  else doc?.defaultView?.open(url, "_blank", "noopener,noreferrer");
}
