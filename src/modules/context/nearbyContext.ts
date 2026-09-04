const DEFAULT_CONTEXT_RADIUS = 600;

function normalizeWithSourceMap(value: string) {
  let text = "";
  const sourceIndexes: number[] = [];
  let previousWasWhitespace = false;
  let sourceOffset = 0;

  for (const character of value) {
    const isMarkdownSyntax = /[`*#>]/.test(character);
    if (/\s/.test(character) || isMarkdownSyntax) {
      if (!previousWasWhitespace) {
        text += " ";
        sourceIndexes.push(sourceOffset);
      }
      previousWasWhitespace = true;
      sourceOffset += character.length;
      continue;
    }

    const folded = character.toLowerCase();
    text += folded;
    for (let index = 0; index < folded.length; index += 1) {
      sourceIndexes.push(sourceOffset);
    }
    previousWasWhitespace = false;
    sourceOffset += character.length;
  }

  return { text, sourceIndexes };
}

export function findNearbyContext(params: {
  fullText: string;
  selectedText?: string;
  radius?: number;
  pageIndex?: number;
}) {
  const selectedText = String(params.selectedText || "").trim();
  if (!params.fullText || !selectedText) return undefined;

  const source = normalizeWithSourceMap(params.fullText);
  const selected = normalizeWithSourceMap(selectedText).text.trim();
  if (!selected) return undefined;

  const occurrences: number[] = [];
  let searchFrom = 0;
  while (searchFrom <= source.text.length - selected.length) {
    const occurrence = source.text.indexOf(selected, searchFrom);
    if (occurrence < 0) break;
    occurrences.push(occurrence);
    searchFrom = occurrence + Math.max(1, selected.length);
  }
  const pageMarker = Number.isInteger(params.pageIndex)
    ? `<!-- page ${(params.pageIndex ?? 0) + 1} -->`
    : undefined;
  const pageMarkerOffset = pageMarker
    ? params.fullText.indexOf(pageMarker)
    : -1;
  const pageEndOffset =
    pageMarkerOffset >= 0
      ? (() => {
          const nextMarker = params.fullText.indexOf(
            "<!-- page ",
            pageMarkerOffset + (pageMarker?.length ?? 0),
          );
          return nextMarker >= 0 ? nextMarker : params.fullText.length;
        })()
      : -1;
  const occurrenceOnPage = occurrences.find((occurrence) => {
    const sourceOffset = source.sourceIndexes[occurrence] ?? -1;
    return sourceOffset >= pageMarkerOffset && sourceOffset < pageEndOffset;
  });
  const matchStart =
    occurrenceOnPage !== undefined
      ? occurrenceOnPage
      : pageMarkerOffset >= 0
        ? (occurrences.sort((left, right) => {
            const leftSource = source.sourceIndexes[left] ?? 0;
            const rightSource = source.sourceIndexes[right] ?? 0;
            return (
              Math.abs(leftSource - pageMarkerOffset) -
              Math.abs(rightSource - pageMarkerOffset)
            );
          })[0] ?? -1)
        : (occurrences[0] ?? -1);
  if (matchStart < 0) return undefined;
  const matchEnd = matchStart + selected.length - 1;
  const originalStart = source.sourceIndexes[matchStart];
  const originalEnd = source.sourceIndexes[matchEnd];
  if (originalStart === undefined || originalEnd === undefined)
    return undefined;

  const radius = Math.max(0, params.radius ?? DEFAULT_CONTEXT_RADIUS);
  const before = params.fullText
    .slice(Math.max(0, originalStart - radius), originalStart)
    .trim();
  const after = params.fullText
    .slice(originalEnd + 1, originalEnd + 1 + radius)
    .trim();
  if (!before && !after) return undefined;

  return [
    before ? `Before selection: ${before}` : undefined,
    after ? `After selection: ${after}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
