const DEFAULT_CONTEXT_RADIUS = 600;

function normalizeWithSourceMap(value: string) {
  let text = "";
  const sourceIndexes: number[] = [];
  let previousWasWhitespace = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/.test(character)) {
      if (!previousWasWhitespace) {
        text += " ";
        sourceIndexes.push(index);
      }
      previousWasWhitespace = true;
      continue;
    }

    text += character.toLowerCase();
    sourceIndexes.push(index);
    previousWasWhitespace = false;
  }

  return { text, sourceIndexes };
}

export function findNearbyContext(params: {
  fullText: string;
  selectedText?: string;
  radius?: number;
}) {
  const selectedText = String(params.selectedText || "").trim();
  if (!params.fullText || !selectedText) return undefined;

  const source = normalizeWithSourceMap(params.fullText);
  const selected = normalizeWithSourceMap(selectedText).text.trim();
  if (!selected) return undefined;

  const matchStart = source.text.indexOf(selected);
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
