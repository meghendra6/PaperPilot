import { splitTextIntoChunks } from "../tools/splitTextIntoChunks";

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

export function getIndexedChunks(params: {
  itemKey: string;
  text: string;
  chunkSize?: number;
  overlapSize?: number;
}) {
  const hash = hashText(params.text);
  const existing = addon.data.paperIndexStore?.get(params.itemKey);
  if (existing?.hash === hash) {
    return existing.chunks;
  }

  const chunks = splitTextIntoChunks(
    params.text,
    params.chunkSize ?? 1100,
    params.overlapSize ?? 200,
  );
  addon.data.paperIndexStore?.set(params.itemKey, { hash, chunks });
  return chunks;
}

export function clearIndexedChunks(itemKey: string) {
  addon.data.paperIndexStore?.delete(itemKey);
}
