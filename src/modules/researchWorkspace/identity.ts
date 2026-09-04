export const FNV1A_OFFSET_BASIS = 2166136261;

export function fnv1a32(value: string, seed = FNV1A_OFFSET_BASIS) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function stableHash(value: string, seed = FNV1A_OFFSET_BASIS) {
  return fnv1a32(value, seed).toString(16).padStart(8, "0");
}

export function normalizeIdentityWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeIdentityDOI(value: unknown) {
  if (typeof value !== "string") return "";
  return normalizeIdentityWhitespace(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[\s.,;]+$/g, "")
    .toLocaleLowerCase();
}

export function normalizeIdentityTitle(value: unknown) {
  if (typeof value !== "string") return "";
  return normalizeIdentityWhitespace(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeIdentityAuthor(value: unknown) {
  return normalizeIdentityTitle(value).split(" ").filter(Boolean).at(-1) ?? "";
}
