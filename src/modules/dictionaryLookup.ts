export type DictionaryLookup = Readonly<{ term: string; url: string }>;

export type DictionaryEntry = {
  headword: string;
  pronunciations: string[];
  senses: Array<{ partOfSpeech: string; meaning: string }>;
  source: string;
  url: string;
};

/** Admit a word or short phrase, never silently truncate a longer selection. */
export function buildDictionaryLookup(
  text: string | undefined,
): DictionaryLookup | undefined {
  const term = (text || "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !/[\p{L}\p{N}]/u.test(term) ||
    term.length > 80 ||
    term.split(" ").length > 8
  ) {
    return undefined;
  }
  // A malformed PDF text layer can contain an unpaired surrogate.
  try {
    return {
      term,
      url: `https://en.dict.naver.com/#/mini/search?query=${encodeURIComponent(term)}`,
    };
  } catch {
    return undefined;
  }
}

export function dictionaryRequestURL(lookup: DictionaryLookup): string {
  return (
    `https://en.dict.naver.com/api3/enko/search?query=${encodeURIComponent(lookup.term)}` +
    "&m=pc&range=word&page=1&lang=ko&shouldSearchOpen=false"
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Convert provider markup to text only. Callers must render with textContent. */
function plainText(value: unknown, max = 320): string {
  if (typeof value !== "string") return "";
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value
    .slice(0, 8000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (entity, key: string) => {
        if (!key.startsWith("#")) return entities[key.toLowerCase()] || entity;
        const point =
          key[1].toLowerCase() === "x"
            ? parseInt(key.slice(2), 16)
            : parseInt(key.slice(1), 10);
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : "";
      },
    )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

const matchKey = (text: string) => text.normalize("NFKC").toLowerCase();

/** The site's internal search response is not a versioned public API. Fail visibly on drift. */
export function parseNaverDictionaryResponse(
  value: unknown,
  lookup: DictionaryLookup,
): DictionaryEntry | undefined {
  const word = record(
    record(record(value).searchResultMap).searchResultListMap,
  ).WORD;
  const result = record(word);
  if (
    !Array.isArray(result.items) ||
    typeof result.query !== "string" ||
    matchKey(result.query.trim()) !== matchKey(lookup.term)
  ) {
    throw new Error("Unrecognized dictionary response");
  }
  const items = result.items.slice(0, 50).map(record);
  const exact = items.filter(
    (item) => matchKey(plainText(item.expEntry, 120)) === matchKey(lookup.term),
  );
  // Naver marks inflections (e.g. models -> model) as exact:subEntry.
  // Do not turn loosely related results into this word's definition.
  const candidates = exact.length
    ? exact
    : items.filter((item) => item.matchType === "exact:subEntry");
  for (const item of candidates) {
    if (!plainText(item.expEntry, 120)) continue;
    const senses: DictionaryEntry["senses"] = [];
    if (!Array.isArray(item.meansCollector)) continue;
    for (const group of item.meansCollector.slice(0, 8).map(record)) {
      if (!Array.isArray(group.means)) continue;
      for (const sense of group.means.slice(0, 8).map(record)) {
        const meaning = plainText(sense.value);
        if (
          meaning &&
          !senses.some((existing) => existing.meaning === meaning)
        ) {
          senses.push({
            partOfSpeech: plainText(group.partOfSpeech, 32),
            meaning,
          });
        }
        if (senses.length === 3) break;
      }
      if (senses.length === 3) break;
    }
    if (!senses.length) continue;
    const pronunciations = Array.isArray(item.searchPhoneticSymbolList)
      ? item.searchPhoneticSymbolList
          .slice(0, 8)
          .map(record)
          .map((part) => plainText(part.symbolValue, 80))
          .filter(Boolean)
      : [];
    const path =
      typeof item.destinationLink === "string" ? item.destinationLink : "";
    return {
      headword: plainText(item.expEntry, 120),
      pronunciations: [...new Set(pronunciations)].slice(0, 2),
      senses,
      source: plainText(item.sourceDictnameKO, 100) || "NAVER Dictionary",
      url: /^#\/entry\/(enko|koen)\/[a-f\d]{32}$/i.test(path)
        ? `https://en.dict.naver.com/${path}`
        : lookup.url,
    };
  }
  if (candidates.length) throw new Error("Dictionary meanings unavailable");
  return undefined;
}
