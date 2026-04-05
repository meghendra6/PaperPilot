import type { HighlightCandidate } from "./types";

export const DEFAULT_AUTO_HIGHLIGHT_LIMIT = 5;

function stripMarkdownFence(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function* extractBalancedJSONObjectCandidates(raw: string) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        yield raw.slice(start, index + 1);
        start = -1;
      }
    }
  }
}

function extractJsonCandidates(raw: string) {
  const trimmed = raw.trim();
  const candidates = new Set<string>();

  if (trimmed) {
    candidates.add(trimmed);
    candidates.add(stripMarkdownFence(trimmed));
  }

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    if (match[1]?.trim()) {
      candidates.add(match[1].trim());
    }
  }

  for (const candidate of extractBalancedJSONObjectCandidates(trimmed)) {
    if (candidate.trim()) {
      candidates.add(candidate.trim());
    }
  }

  return [...candidates];
}

function normalizeParsedHighlights(
  parsed: unknown,
  limit: number,
): HighlightCandidate[] | undefined {
  const source = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { highlights?: unknown }).highlights)
      ? (parsed as { highlights: unknown[] }).highlights
      : undefined;

  if (!source) {
    return undefined;
  }

  const normalized = source
    .map((entry): HighlightCandidate | undefined => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const record = entry as Record<string, unknown>;
      const quote = typeof record.quote === "string" ? record.quote.trim() : "";
      if (!quote) {
        return undefined;
      }
      return {
        quote,
        ...(typeof record.reason === "string" && record.reason.trim()
          ? { reason: record.reason.trim() }
          : {}),
        ...(typeof record.importance === "number"
          ? { importance: record.importance }
          : {}),
      };
    })
    .filter((entry): entry is HighlightCandidate => Boolean(entry))
    .slice(0, Math.max(0, limit));

  return normalized;
}

export function buildAutoHighlightQuestion(
  limit = DEFAULT_AUTO_HIGHLIGHT_LIMIT,
) {
  return [
    "Identify the most important passages in the currently open paper.",
    `Return ONLY a single strict JSON only object with at most ${limit} highlights using this schema:`,
    '{"highlights":[{"quote":"exact passage text from the paper","reason":"short reason","importance":0.94}]}',
    "Rules:",
    "- quote must be verbatim from the paper text",
    "- no paraphrases",
    "- no markdown fences",
    "- each quote MUST be a single complete sentence or a short contiguous phrase (1-2 sentences max)",
    "- do NOT select entire paragraphs or multi-sentence blocks",
    "- prefer specific claims, findings, or definitions over vague introductory sentences",
    "- select passages that a researcher would highlight when studying the paper:",
    "  - novel contributions or key claims",
    "  - core methodology or algorithm descriptions",
    "  - main quantitative results or comparisons",
    "  - important limitations or assumptions",
    "  - key definitions or formal statements",
    "- avoid selecting overlapping or adjacent passages; spread highlights across the paper",
    "- keep quotes concise but sufficient for exact matching",
    "- keep each reason short and evidence-based",
    "- importance must be a number between 0 and 1",
    "- minor punctuation differences and whitespace are tolerated during matching, but preserve the core words exactly",
    "- omit any candidate unless you are confident it appears exactly in paper.txt",
  ].join("\n");
}

export function buildAutoHighlightRepairQuestion(
  rawResponse: string,
  limit = DEFAULT_AUTO_HIGHLIGHT_LIMIT,
) {
  return [
    "Reformat the following response into ONLY a single strict JSON object.",
    `Output schema: {"highlights":[{"quote":"exact passage text from the paper","reason":"short reason","importance":0.94}]}`,
    `Keep at most ${limit} highlights.`,
    'If the source response does not contain usable exact quotes, output {"highlights":[]}.',
    "",
    "Source response:",
    rawResponse,
  ].join("\n");
}

export function parseAutoHighlightResponse(
  raw: string,
  limit = DEFAULT_AUTO_HIGHLIGHT_LIMIT,
): HighlightCandidate[] {
  let parseError: unknown;

  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeParsedHighlights(parsed, limit);
      if (normalized && normalized.length) {
        return normalized;
      }
      if (normalized && !normalized.length) {
        throw new Error("Codex did not return any usable exact quotes.");
      }
    } catch (error) {
      parseError = error;
    }
  }

  throw new Error(
    `Codex returned invalid highlight JSON: ${
      parseError instanceof Error
        ? parseError.message
        : "no parseable JSON object with highlights found"
    }`,
  );
}
