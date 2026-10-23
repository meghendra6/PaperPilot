const PROTECTED_DOT = "";

export interface SentenceSlice {
  /** The sentence text as it appears in the input, with its dots. */
  text: string;
  /** Offset of the sentence in the input. */
  start: number;
}

/**
 * Splits prose into sentences for citation and draft checks.
 *
 * - A single line break is a space, so a hard-wrapped sentence stays whole.
 *   A blank line ends a paragraph.
 * - A dot that is not followed by whitespace ("2.5", "github.com", "U.S")
 *   stays inside the sentence, as do common abbreviations ("et al.").
 *
 * Every replacement keeps the input length, so offsets point into `value`.
 */
export function splitSentences(value: string): SentenceSlice[] {
  const prepared = value
    .replace(
      /\b(?:et\s+al|e\.g|i\.e|fig|eq|dr|mr|mrs|prof|vs|cf)\./gi,
      (match) => match.replace(/\./g, PROTECTED_DOT),
    )
    .replace(/(?<=\d)\.(?=\d)/g, PROTECTED_DOT)
    .replace(/(?<!\n)\r?\n(?![\r\n])/g, (match) => " ".repeat(match.length));
  const result: SentenceSlice[] = [];
  // Each run stops at a line break, at sentence punctuation before
  // whitespace, or at the end, and every stop is a valid terminator. So
  // every match succeeds and matching stays linear.
  const expression = /(?:[^.!?\n]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|(?=\n)|$)/g;
  for (const match of prepared.matchAll(expression)) {
    const start = match.index ?? 0;
    result.push({
      text: value.slice(start, start + match[0].length),
      start,
    });
  }
  return result;
}
