import type { ResearchWorkspacePaper } from "./paperSource";
import { stableHash } from "./identity";

export const RESEARCH_WORKSPACE_CONTEXT_PLANNER_VERSION =
  "context-planner-v1" as const;

export interface ResearchWorkspaceContextProjection {
  sourceID: string;
  title: string;
  includedText: string;
  includedChunkIDs: string[];
  omittedChunkIDs: string[];
  includedCharacters: number;
  omittedCharacters: number;
  availableCharacters: number;
  coverage: number;
  fingerprint: string;
  insufficient: boolean;
}

export interface ResearchWorkspaceContextPlan {
  plannerVersion: typeof RESEARCH_WORKSPACE_CONTEXT_PLANNER_VERSION;
  operation: string;
  requestedBudget: number;
  usedCharacters: number;
  omittedCharacters: number;
  insufficientCoverage: boolean;
  projections: ResearchWorkspaceContextProjection[];
  fingerprint: string;
}

interface CandidateChunk {
  id: string;
  text: string;
  score: number;
}

function stableFingerprint(value: string) {
  return `fnv1a32:${value.length}:${stableHash(value)}`;
}

function terms(operation: string, query?: string) {
  return [
    ...new Set(
      `${operation} ${query ?? ""}`
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{3,}/gu) ?? [],
    ),
  ].sort();
}

function score(text: string, searchTerms: readonly string[]) {
  const normalized = text.toLowerCase();
  return searchTerms.reduce((total, term) => {
    let count = 0;
    let offset = 0;
    while (count < 8) {
      const found = normalized.indexOf(term, offset);
      if (found < 0) break;
      count += 1;
      offset = found + term.length;
    }
    return total + count;
  }, 0);
}

function plainChunks(paper: ResearchWorkspacePaper) {
  const chunks: Array<{ id: string; text: string }> = [];
  const paragraphs = paper.context
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  let ordinal = 0;
  for (const paragraph of paragraphs) {
    for (let offset = 0; offset < paragraph.length; offset += 2_000) {
      const text = paragraph.slice(offset, offset + 2_000).trim();
      if (!text) continue;
      chunks.push({ id: `${paper.sourceID}:text-${ordinal}`, text });
      ordinal += 1;
    }
  }
  if (!chunks.length && paper.context.trim()) {
    chunks.push({
      id: `${paper.sourceID}:text-0`,
      text: paper.context.trim().slice(0, 2_000),
    });
  }
  return chunks;
}

function candidates(
  paper: ResearchWorkspacePaper,
  searchTerms: readonly string[],
): CandidateChunk[] {
  const source = paper.structuredChunks?.length
    ? paper.structuredChunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
      }))
    : plainChunks(paper);
  return source
    .map((chunk) => ({
      ...chunk,
      score: score(`${paper.title}\n${chunk.text}`, searchTerms),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    );
}

function chooseChunks(
  paper: ResearchWorkspacePaper,
  searchTerms: readonly string[],
  quota: number,
) {
  const available = candidates(paper, searchTerms);
  const selected: CandidateChunk[] = [];
  let used = 0;
  for (const chunk of available) {
    const separator = selected.length ? 2 : 0;
    const remaining = Math.max(0, quota - used - separator);
    if (!remaining) break;
    const text = chunk.text.slice(0, remaining).trim();
    if (!text) continue;
    selected.push({ ...chunk, text });
    used += separator + text.length;
    if (text.length < chunk.text.length) break;
  }
  const includedIDs = new Set(selected.map((chunk) => chunk.id));
  const includedText = selected.map((chunk) => chunk.text).join("\n\n");
  const availableCharacters = available.reduce(
    (total, chunk) => total + chunk.text.length,
    0,
  );
  return {
    includedText,
    includedChunkIDs: selected.map((chunk) => chunk.id),
    omittedChunkIDs: available
      .filter((chunk) => !includedIDs.has(chunk.id))
      .map((chunk) => chunk.id),
    includedCharacters: includedText.length,
    availableCharacters,
  };
}

export function planResearchWorkspaceContext(params: {
  papers: readonly ResearchWorkspacePaper[];
  operation: string;
  query?: string;
  totalCharacters?: number;
  minimumCharactersPerSource?: number;
}): ResearchWorkspaceContextPlan {
  if (!params.papers.length)
    throw new Error("Context planning requires papers.");
  const papers = [...params.papers].sort((left, right) =>
    left.sourceID.localeCompare(right.sourceID),
  );
  const requestedBudget = Math.max(
    papers.length,
    Math.floor(params.totalCharacters ?? 180_000),
  );
  const minimum = Math.max(
    1,
    Math.floor(params.minimumCharactersPerSource ?? 2_000),
  );
  const base = Math.min(minimum, Math.floor(requestedBudget / papers.length));
  const baseBudget = base * papers.length;
  const extra = requestedBudget - baseBudget;
  const searchTerms = terms(params.operation, params.query);
  const relevance = papers.map((paper) =>
    Math.max(
      1,
      score(`${paper.title}\n${paper.context.slice(0, 12_000)}`, searchTerms),
    ),
  );
  const relevanceTotal = relevance.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  const quotas = papers.map((_paper, index) => {
    const allocation =
      index === papers.length - 1
        ? extra - assigned
        : Math.floor((extra * relevance[index]) / relevanceTotal);
    assigned += allocation;
    return base + allocation;
  });
  const projections = papers.map((paper, index) => {
    const chosen = chooseChunks(paper, searchTerms, quotas[index]);
    const omittedCharacters = Math.max(
      0,
      chosen.availableCharacters - chosen.includedCharacters,
    );
    const projection: ResearchWorkspaceContextProjection = {
      sourceID: paper.sourceID,
      title: paper.title,
      includedText: chosen.includedText,
      includedChunkIDs: chosen.includedChunkIDs,
      omittedChunkIDs: chosen.omittedChunkIDs,
      includedCharacters: chosen.includedCharacters,
      omittedCharacters,
      availableCharacters: chosen.availableCharacters,
      coverage:
        chosen.availableCharacters > 0
          ? chosen.includedCharacters / chosen.availableCharacters
          : 0,
      fingerprint: stableFingerprint(
        [
          RESEARCH_WORKSPACE_CONTEXT_PLANNER_VERSION,
          params.operation,
          paper.sourceID,
          paper.contentFingerprint.value,
          chosen.includedChunkIDs.join("\n"),
          chosen.includedText,
        ].join("\u0000"),
      ),
      insufficient:
        chosen.includedCharacters < Math.min(base, chosen.availableCharacters),
    };
    return projection;
  });
  const usedCharacters = projections.reduce(
    (total, projection) => total + projection.includedCharacters,
    0,
  );
  const omittedCharacters = projections.reduce(
    (total, projection) => total + projection.omittedCharacters,
    0,
  );
  const insufficientCoverage = projections.some(
    (projection) => projection.insufficient || projection.coverage < 0.1,
  );
  const plan = {
    plannerVersion: RESEARCH_WORKSPACE_CONTEXT_PLANNER_VERSION,
    operation: params.operation,
    requestedBudget,
    usedCharacters,
    omittedCharacters,
    insufficientCoverage,
    projections,
  };
  return {
    ...plan,
    fingerprint: stableFingerprint(JSON.stringify(plan)),
  };
}

export function applyResearchWorkspaceContextPlan(
  papers: readonly ResearchWorkspacePaper[],
  plan: ResearchWorkspaceContextPlan,
) {
  const bySource = new Map(
    plan.projections.map((projection) => [projection.sourceID, projection]),
  );
  return papers.map((paper) => {
    const projection = bySource.get(paper.sourceID);
    if (!projection)
      throw new Error(`Missing context projection for ${paper.sourceID}.`);
    return {
      ...paper,
      context: [
        `<paper source_id="${paper.sourceID}" attachment_key="${paper.attachmentKey}">`,
        projection.includedText.replace(/<\/paper/gi, "<\\/paper"),
        "</paper>",
      ].join("\n"),
      structuredChunks: paper.structuredChunks?.filter((chunk) =>
        projection.includedChunkIDs.includes(chunk.id),
      ),
    };
  });
}
