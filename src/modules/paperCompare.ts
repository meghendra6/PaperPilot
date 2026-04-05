import type {
  RecommendationGroup,
  RecommendedPaper,
} from "./relatedRecommendations";
import type { PaperArtifactCard, PaperArtifactSection } from "./paperArtifacts";
import { buildResponseLanguageInstruction } from "./translation/responseLanguage";

export interface PaperCompareCandidate {
  title: string;
  authors?: string[];
  year?: number | string;
  abstract?: string;
  reason?: string;
}

export interface PaperCompareSelection {
  currentPaper: PaperCompareCandidate;
  comparePapers: PaperCompareCandidate[];
  droppedTitles: string[];
}

export interface PaperCompareRequest {
  label: string;
  selection: PaperCompareSelection;
  prompt: string;
}

export interface PaperCompareEntryState {
  enabled: boolean;
  reason: string;
  candidateCount: number;
}

export interface PaperCompareButtonState extends PaperCompareEntryState {
  label: string;
  title: string;
  ariaLabel: string;
}

export interface PaperCompareWorkflowState {
  enabled: boolean;
  helperText: string;
  tone: "muted" | "ready";
  candidateCount: number;
}

export interface PaperCompareEntry {
  title: string;
  relationship: string;
  strengths: string[];
  tradeoffs: string[];
  bestUseCase?: string;
}

export interface PaperCompareResult {
  overview: string;
  papers: PaperCompareEntry[];
  synthesis: string[];
  recommendations: string[];
}

export interface PaperCompareMetrics {
  comparedPaperCount: number;
  snapshotCount: number;
  synthesisCount: number;
  recommendationCount: number;
  hasInferenceContent: boolean;
  compactSafe: boolean;
}

const MAX_COMPARE_PAPERS = 3;
const MAX_COMPARE_LIST_ITEMS = 4;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

function toStringList(value: unknown, maxItems = MAX_COMPARE_LIST_ITEMS) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((entry) =>
      typeof entry === "string" ? normalizeWhitespace(entry) : "",
    )
    .filter(Boolean)
    .slice(0, maxItems);
}

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

function normalizeCompareEntry(parsed: unknown): PaperCompareEntry | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const title = toOptionalString(record.title);
  const relationship = toOptionalString(record.relationship);
  const strengths = toStringList(record.strengths);
  const tradeoffs = toStringList(record.tradeoffs);
  const bestUseCase = toOptionalString(record.bestUseCase);

  if (!title || !relationship || (!strengths.length && !tradeoffs.length)) {
    return undefined;
  }

  return {
    title,
    relationship,
    strengths,
    tradeoffs,
    ...(bestUseCase ? { bestUseCase } : {}),
  };
}

function normalizePaperCompareResult(
  parsed: unknown,
): PaperCompareResult | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const overview = toOptionalString(record.overview);
  const papers = Array.isArray(record.papers)
    ? record.papers
        .map((entry) => normalizeCompareEntry(entry))
        .filter((entry): entry is PaperCompareEntry => Boolean(entry))
        .slice(0, MAX_COMPARE_PAPERS + 1)
    : [];
  const synthesis = toStringList(record.synthesis);
  const recommendations = toStringList(record.recommendations);

  if (!overview || papers.length < 2) {
    return undefined;
  }

  if (!synthesis.length && !recommendations.length) {
    throw new Error(
      "Paper compare result did not include synthesis or recommendations.",
    );
  }

  return {
    overview,
    papers,
    synthesis,
    recommendations,
  };
}

function formatCandidate(candidate: PaperCompareCandidate, index?: number) {
  return [
    index ? `Paper ${index}` : undefined,
    `Title: ${candidate.title}`,
    candidate.authors?.length
      ? `Authors: ${candidate.authors.join(", ")}`
      : undefined,
    candidate.year ? `Year: ${candidate.year}` : undefined,
    candidate.reason ? `Why it was selected: ${candidate.reason}` : undefined,
    candidate.abstract ? `Abstract: ${candidate.abstract}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCompareSelection(params: {
  currentPaper: PaperCompareCandidate;
  comparePapers: PaperCompareCandidate[];
  maxComparePapers?: number;
}): PaperCompareSelection {
  const limit = Math.max(1, params.maxComparePapers || MAX_COMPARE_PAPERS);
  const seen = new Set([params.currentPaper.title.toLowerCase()]);
  const accepted: PaperCompareCandidate[] = [];
  const droppedTitles: string[] = [];

  for (const rawPaper of params.comparePapers) {
    const title = normalizeWhitespace(rawPaper.title);
    if (!title) {
      continue;
    }
    const key = title.toLowerCase();
    if (seen.has(key) || accepted.length >= limit) {
      droppedTitles.push(title);
      continue;
    }
    seen.add(key);
    accepted.push({
      ...rawPaper,
      title,
      abstract: toOptionalString(rawPaper.abstract),
      reason: toOptionalString(rawPaper.reason),
      authors: rawPaper.authors
        ?.map((author) => normalizeWhitespace(author))
        .filter(Boolean),
      year:
        typeof rawPaper.year === "number"
          ? rawPaper.year
          : toOptionalString(rawPaper.year),
    });
  }

  if (!accepted.length) {
    throw new Error("At least one comparison paper is required.");
  }

  return {
    currentPaper: {
      ...params.currentPaper,
      title: normalizeWhitespace(params.currentPaper.title),
      abstract: toOptionalString(params.currentPaper.abstract),
      reason: toOptionalString(params.currentPaper.reason),
      authors: params.currentPaper.authors
        ?.map((author) => normalizeWhitespace(author))
        .filter(Boolean),
      year:
        typeof params.currentPaper.year === "number"
          ? params.currentPaper.year
          : toOptionalString(params.currentPaper.year),
    },
    comparePapers: accepted,
    droppedTitles,
  };
}

export function selectCompareCandidates(
  groups: { papers: RecommendedPaper[] }[],
) {
  const selected: RecommendedPaper[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const paper of group.papers) {
      const key = `${paper.title.toLowerCase()}|${paper.doi || ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      selected.push(paper);
      if (selected.length >= MAX_COMPARE_PAPERS) {
        return selected;
      }
    }
  }

  return selected;
}

export function buildCompareSelectionFromRecommendations(params: {
  currentPaper: PaperCompareCandidate;
  groups: RecommendationGroup[];
  maxComparePapers?: number;
}): PaperCompareSelection {
  const candidates = selectCompareCandidates(params.groups).map((paper) => ({
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    abstract: paper.abstract,
    reason: paper.reason,
  }));

  return buildCompareSelection({
    currentPaper: params.currentPaper,
    comparePapers: candidates,
    maxComparePapers: params.maxComparePapers,
  });
}

export function buildPaperCompareRequestFromRecommendations(params: {
  currentPaper: PaperCompareCandidate;
  groups: RecommendationGroup[];
  maxComparePapers?: number;
  responseLanguage?: string;
}): PaperCompareRequest {
  const selection = buildCompareSelectionFromRecommendations(params);
  return {
    label: "Compare papers",
    selection,
    prompt: buildPaperCompareQuestion({
      currentPaper: selection.currentPaper,
      comparePapers: selection.comparePapers,
      responseLanguage: params.responseLanguage,
    }),
  };
}

export function getPaperCompareEntryState(params: {
  currentPaperTitle?: string;
  groups: RecommendationGroup[];
  maxComparePapers?: number;
}): PaperCompareEntryState {
  const currentPaperTitle = toOptionalString(params.currentPaperTitle);
  if (!currentPaperTitle) {
    return {
      enabled: false,
      reason: "Current paper metadata is unavailable.",
      candidateCount: 0,
    };
  }

  const candidateCount = selectCompareCandidates(params.groups).length;
  if (!candidateCount) {
    return {
      enabled: false,
      reason: "Need at least one recommended peer before compare can run.",
      candidateCount: 0,
    };
  }

  const boundedCount = Math.min(
    candidateCount,
    Math.max(1, params.maxComparePapers || MAX_COMPARE_PAPERS),
  );
  return {
    enabled: true,
    reason:
      boundedCount === 1
        ? "Compare will use the current paper plus 1 peer."
        : `Compare will use the current paper plus ${boundedCount} peers.`,
    candidateCount: boundedCount,
  };
}

export function getPaperCompareButtonState(params: {
  currentPaperTitle?: string;
  groups: RecommendationGroup[];
  maxComparePapers?: number;
}): PaperCompareButtonState {
  const state = getPaperCompareEntryState(params);
  const peerCount = state.candidateCount;
  const peerLabel = peerCount === 1 ? "1 peer" : `${peerCount} peers`;

  return {
    ...state,
    label: state.enabled && peerCount ? `Compare (${peerCount})` : "Compare",
    title: state.reason,
    ariaLabel: state.enabled
      ? `Compare with ${peerLabel} ready`
      : `Compare unavailable: ${state.reason}`,
  };
}

export function getPaperCompareWorkflowState(params: {
  currentPaperTitle?: string;
  groups: RecommendationGroup[];
  recommendationsRunning?: boolean;
  maxComparePapers?: number;
}): PaperCompareWorkflowState {
  if (params.recommendationsRunning) {
    return {
      enabled: false,
      helperText:
        "Step 1 of 2: Finding related papers… Compare unlocks when recommendations are ready.",
      tone: "muted",
      candidateCount: 0,
    };
  }

  const entryState = getPaperCompareEntryState(params);
  if (!entryState.enabled) {
    return {
      enabled: false,
      helperText:
        entryState.reason ===
        "Need at least one recommended peer before compare can run."
          ? "Step 1 of 2: Run Recommend related papers. Step 2 of 2: Compare unlocks after at least one peer is ready."
          : entryState.reason,
      tone: "muted",
      candidateCount: entryState.candidateCount,
    };
  }

  return {
    enabled: true,
    helperText:
      entryState.candidateCount === 1
        ? "Step 2 of 2: Compare is ready with 1 recommended peer."
        : `Step 2 of 2: Compare is ready with ${entryState.candidateCount} recommended peers.`,
    tone: "ready",
    candidateCount: entryState.candidateCount,
  };
}

export function buildPaperCompareQuestion(params: {
  currentPaper: PaperCompareCandidate;
  comparePapers: PaperCompareCandidate[];
  responseLanguage?: string;
}) {
  const selection = buildCompareSelection({
    currentPaper: params.currentPaper,
    comparePapers: params.comparePapers,
    maxComparePapers: MAX_COMPARE_PAPERS,
  });
  const boundedComparePapers = selection.comparePapers;

  return [
    "Compare the current paper against the selected related papers for a Zotero reader-pane workflow.",
    params.responseLanguage
      ? buildResponseLanguageInstruction(params.responseLanguage)
      : undefined,
    "Return ONLY one strict JSON object using this schema:",
    '{"overview":"1-2 sentence compare summary","papers":[{"title":"paper title","relationship":"how it differs or complements the current paper","strengths":["strength"],"tradeoffs":["tradeoff"],"bestUseCase":"when to read or use it"}],"synthesis":["cross-paper insight"],"recommendations":["what to read or do next"]}',
    "Rules:",
    `- include the current paper plus at most ${MAX_COMPARE_PAPERS} comparison papers in papers[]`,
    `- use only the current paper plus the provided comparison set; do not invent extra papers or missing details`,
    `- keep each strengths/tradeoffs list to at most ${MAX_COMPARE_LIST_ITEMS} bullets`,
    "- keep every field compact and reader-pane-safe",
    "- distinguish direct paper claims from cross-paper inference whenever needed",
    "- recommendations should be actionable next-reading advice, not generic summary restatements",
    "",
    "Current paper:",
    formatCandidate(selection.currentPaper),
    "",
    "Comparison set:",
    ...boundedComparePapers.map((paper, index) =>
      formatCandidate(paper, index + 1),
    ),
  ].join("\n");
}

export function parsePaperCompareResponse(raw: string): PaperCompareResult {
  let parseError: unknown;

  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizePaperCompareResult(parsed);
      if (normalized) {
        return normalized;
      }
    } catch (error) {
      parseError = error;
    }
  }

  throw new Error(
    `Invalid paper compare JSON: ${
      parseError instanceof Error
        ? parseError.message
        : "no parseable JSON object with usable compare sections found"
    }`,
  );
}

export function buildPaperCompareCard(
  result: PaperCompareResult,
): PaperArtifactCard {
  const sections: PaperArtifactSection[] = [
    {
      heading: "Paper snapshots",
      items: result.papers.map((paper) => {
        const segments = [
          `${paper.title}: ${paper.relationship}`,
          paper.strengths.length
            ? `Strengths — ${paper.strengths.join("; ")}`
            : undefined,
          paper.tradeoffs.length
            ? `Tradeoffs — ${paper.tradeoffs.join("; ")}`
            : undefined,
          paper.bestUseCase ? `Best use — ${paper.bestUseCase}` : undefined,
        ].filter(Boolean);
        return segments.join(" | ");
      }),
      evidence: "mixed" as const,
    },
    {
      heading: "Synthesis",
      items: result.synthesis,
      evidence: "mixed" as const,
    },
    {
      heading: "Recommended next reading",
      items: result.recommendations,
      evidence: "inference" as const,
    },
  ].filter((section) => section.items.length);

  return {
    kind: "paper-compare",
    title: "Compare papers",
    summary: result.overview,
    sections,
    sourceLabel:
      "Compare output is a compact synthesis across the current paper and a bounded related-paper set; cross-paper conclusions may include model inference.",
    updatedAt: new Date().toISOString(),
  };
}

export function buildPaperCompareCardFromResponse(raw: string) {
  return buildPaperCompareCard(parsePaperCompareResponse(raw));
}

export function getPaperCompareMetrics(
  result: PaperCompareResult,
): PaperCompareMetrics {
  const comparedPaperCount = result.papers.length;
  const synthesisCount = result.synthesis.length;
  const recommendationCount = result.recommendations.length;
  return {
    comparedPaperCount,
    snapshotCount: comparedPaperCount,
    synthesisCount,
    recommendationCount,
    hasInferenceContent: Boolean(recommendationCount),
    compactSafe:
      comparedPaperCount <= MAX_COMPARE_PAPERS &&
      synthesisCount <= MAX_COMPARE_LIST_ITEMS &&
      recommendationCount <= MAX_COMPARE_LIST_ITEMS,
  };
}
