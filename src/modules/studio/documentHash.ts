/** Digest original bytes, not their JSON/base64 representation. */
export async function documentHash(
  base64: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
