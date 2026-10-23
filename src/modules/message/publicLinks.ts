import {
  isIPAddressLiteral,
  isNonPublicIPAddress,
} from "../../utils/ipAddress";

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
    // A trailing dot names the same host ("localhost." is localhost).
    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.+$/, "");
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      (isIPAddressLiteral(host) && isNonPublicIPAddress(host))
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
