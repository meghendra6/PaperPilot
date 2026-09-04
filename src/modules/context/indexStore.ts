import { splitTextIntoChunks } from "../tools/splitTextIntoChunks";

const MAX_INDEXED_PAPERS = 12;

type PaperIndexStore = Map<string, { hash: string; chunks: string[] }>;

function getStore(): PaperIndexStore | undefined {
  return (
    globalThis as typeof globalThis & {
      addon?: { data?: { paperIndexStore?: PaperIndexStore } };
    }
  ).addon?.data?.paperIndexStore;
}

export function buildPaperIndexKey(
  libraryID: number | string,
  itemKey: string,
) {
  return `${String(libraryID)}:${itemKey}`;
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

export function getIndexedChunks(params: {
  libraryID: number | string;
  itemKey: string;
  text: string;
  chunkSize?: number;
  overlapSize?: number;
}) {
  const store = getStore();
  const key = buildPaperIndexKey(params.libraryID, params.itemKey);
  const hash = hashText(params.text);
  const existing = store?.get(key);
  if (existing?.hash === hash) {
    store?.delete(key);
    store?.set(key, existing);
    return existing.chunks;
  }

  const chunks = splitTextIntoChunks(
    params.text,
    params.chunkSize ?? 1100,
    params.overlapSize ?? 200,
  );
  store?.delete(key);
  store?.set(key, { hash, chunks });
  while (store && store.size > MAX_INDEXED_PAPERS) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
  return chunks;
}

export function clearIndexedChunks(params: {
  libraryID: number | string;
  itemKey: string;
}) {
  getStore()?.delete(buildPaperIndexKey(params.libraryID, params.itemKey));
}
