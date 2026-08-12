import { getModeForItem } from "./ai/modeStore";
import {
  claimWorkspaceRunReservation,
  extractWorkspaceRunText,
  getWorkspaceEngineActiveMessage,
  getWorkspaceEngineLabel,
  readWorkspaceRunProgress,
  releaseWorkspaceRunReservation,
  startWorkspaceTextRun,
} from "./ai/workspaceRun";
import { stopDetachedRunProcess } from "./ai/runCompletion";
import {
  parseDiscoveryResult,
  parsePublicReviewInsight,
} from "./discovery/parser";
import {
  buildDiscoveryQuestion,
  buildPublicReviewInsightQuestion,
} from "./discovery/prompt";
import type {
  DiscoveredPaper,
  DiscoveryResult,
  LeadingVenueAssessment,
  NoveltyRelationship,
  PublicationClass,
  PublicationEvidence,
  PublicReviewInsight,
  RelationshipStrength,
  ResearchConcern,
} from "./discovery/types";
import { normalizeResponseLanguage } from "./translation/responseLanguage";
import { getPref } from "../utils/prefs";
import {
  canRunDiscovery,
  getDiscoveryCapabilities,
} from "./discovery/capabilities";
import {
  buildStructuredSeedQueries,
  searchCandidateProviders,
} from "./discovery/providers/search";
import { verifyDiscoveryEvidenceLive } from "./discovery/workflow";
import { deduplicateProviderCandidates } from "./discovery/normalize";

declare const Zotero: any;

export interface RecommendedPaper {
  candidateID?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  relevanceScore: number;
  reason?: string;
  existingItemID?: number;
  urls?: string[];
  providerIDs?: Record<string, string>;
  publicationClass?: PublicationClass;
  publicationEvidence?: PublicationEvidence[];
  evidenceConfidence?: "high" | "medium" | "low" | "none";
  leadingVenueAssessment?: LeadingVenueAssessment;
  relationship?: RelationshipStrength;
  keyDifference?: string;
  noveltyRelationship?: NoveltyRelationship;
  reviewURL?: string;
  reviewInsight?: PublicReviewInsight;
  searchConcern?: string;
}

export interface RecommendationGroup {
  category: string;
  papers: RecommendedPaper[];
}

export interface RelatedPaperResponse {
  groups: RecommendationGroup[];
  discovery?: DiscoveryResult;
}

export interface LibraryItemCandidate {
  id: number;
  title?: string;
  year?: number;
  doi?: string;
}

export const PREFERRED_CATEGORY_ORDER = [
  "Verified main-conference papers",
  "Other peer-reviewed work",
  "Frontier / novelty radar",
  "Closest match",
  "Foundational / background",
  "Methods / technique",
  "Applications / extensions",
  "Contrasting / alternative",
] as const;

function discoveredPaperToRecommendation(
  paper: DiscoveredPaper,
  searchConcern?: string,
): RecommendedPaper {
  return {
    candidateID: paper.candidateID,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venueName,
    doi: paper.doi,
    url: paper.urls[0],
    urls: paper.urls,
    abstract: paper.abstract,
    relevanceScore:
      paper.relationship === "direct"
        ? 1
        : paper.relationship === "strong"
          ? 0.75
          : 0.5,
    reason: paper.relevanceReason,
    existingItemID: paper.existingItemID,
    providerIDs: paper.providerIDs,
    publicationClass: paper.publicationClass,
    publicationEvidence: paper.publicationEvidence,
    evidenceConfidence: paper.evidenceConfidence,
    leadingVenueAssessment: paper.leadingVenueAssessment,
    relationship: paper.relationship,
    keyDifference: paper.keyDifference,
    noveltyRelationship: paper.noveltyRelationship,
    reviewURL: paper.reviewURL,
    reviewInsight: paper.reviewInsight,
    searchConcern,
  };
}

export function discoveryResultToRecommendationGroups(
  discovery: DiscoveryResult,
) {
  return [
    {
      category: "Verified main-conference papers",
      papers: discovery.verifiedMain.map((paper) =>
        discoveredPaperToRecommendation(paper, discovery.plan.concernSummary),
      ),
    },
    {
      category: "Other peer-reviewed work",
      papers: discovery.otherPeerReviewed.map((paper) =>
        discoveredPaperToRecommendation(paper, discovery.plan.concernSummary),
      ),
    },
    {
      category: "Frontier / novelty radar",
      papers: discovery.noveltyRadar.map((paper) =>
        discoveredPaperToRecommendation(paper, discovery.plan.concernSummary),
      ),
    },
  ];
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeDOI(value: string) {
  return normalizeWhitespace(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

function extractJSONObject(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Recommendation response was empty.");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function toOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

function toOptionalYear(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const match = value.match(/\d{4}/);
    if (match) {
      return Number.parseInt(match[0], 10);
    }
  }
  return undefined;
}

function toAuthors(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((author) =>
      typeof author === "string" ? normalizeWhitespace(author) : "",
    )
    .filter(Boolean);
}

function toRelevanceScore(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, parsed));
}

export function sortRecommendationGroups(groups: RecommendationGroup[]) {
  const categoryOrder = new Map(
    PREFERRED_CATEGORY_ORDER.map((category, index) => [
      category.toLowerCase(),
      index,
    ]),
  );

  return groups
    .map((group) => ({
      category: normalizeWhitespace(group.category),
      papers: [...group.papers].sort(
        (left, right) => right.relevanceScore - left.relevanceScore,
      ),
    }))
    .sort((left, right) => {
      const leftIndex =
        categoryOrder.get(left.category.toLowerCase()) ??
        Number.MAX_SAFE_INTEGER;
      const rightIndex =
        categoryOrder.get(right.category.toLowerCase()) ??
        Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return left.category.localeCompare(right.category);
    });
}

export function parseRelatedPaperResponse(raw: string): RelatedPaperResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSONObject(raw));
  } catch (error) {
    throw new Error(
      `Invalid related paper recommendation JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    (Array.isArray((parsed as { verifiedMain?: unknown }).verifiedMain) ||
      Array.isArray(
        (parsed as { otherPeerReviewed?: unknown }).otherPeerReviewed,
      ) ||
      Array.isArray((parsed as { noveltyRadar?: unknown }).noveltyRadar))
  ) {
    const discovery = parseDiscoveryResult(raw);
    const groups = discoveryResultToRecommendationGroups(discovery);
    if (!groups.some((group) => group.papers.length)) {
      throw new Error("Discovery response did not include any usable papers.");
    }
    return { groups, discovery };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { groups?: unknown }).groups)
  ) {
    throw new Error("Recommendation JSON must include a groups array.");
  }

  const groups: RecommendationGroup[] = [];
  for (const group of (parsed as { groups: unknown[] }).groups) {
    if (!group || typeof group !== "object") {
      continue;
    }
    const category = toOptionalString(
      (group as { category?: unknown }).category,
    );
    const papersRaw = Array.isArray((group as { papers?: unknown }).papers)
      ? (group as { papers: unknown[] }).papers
      : [];
    const papers: RecommendedPaper[] = [];

    for (const paper of papersRaw) {
      if (!paper || typeof paper !== "object") {
        continue;
      }
      const title = toOptionalString((paper as { title?: unknown }).title);
      if (!title) {
        continue;
      }
      papers.push({
        title,
        authors: toAuthors((paper as { authors?: unknown }).authors),
        year: toOptionalYear((paper as { year?: unknown }).year),
        venue: toOptionalString((paper as { venue?: unknown }).venue),
        doi: toOptionalString((paper as { doi?: unknown }).doi),
        url: toOptionalString((paper as { url?: unknown }).url),
        abstract: toOptionalString((paper as { abstract?: unknown }).abstract),
        relevanceScore: toRelevanceScore(
          (paper as { relevanceScore?: unknown }).relevanceScore,
        ),
        reason: toOptionalString((paper as { reason?: unknown }).reason),
      });
    }

    if (!category || !papers.length) {
      continue;
    }

    groups.push({ category, papers });
  }

  if (!groups.length) {
    throw new Error(
      "Recommendation response did not include any usable groups.",
    );
  }

  return {
    groups: sortRecommendationGroups(groups),
  };
}

export function findExistingLibraryItem(
  paper: Pick<RecommendedPaper, "title" | "year" | "doi">,
  candidates: LibraryItemCandidate[],
) {
  const normalizedDOI = paper.doi ? normalizeDOI(paper.doi) : undefined;
  if (normalizedDOI) {
    const doiMatch = candidates.find(
      (candidate) =>
        candidate.doi && normalizeDOI(candidate.doi) === normalizedDOI,
    );
    if (doiMatch) {
      return doiMatch;
    }
  }

  const normalizedPaperTitle = normalizeTitle(paper.title);
  return candidates.find((candidate) => {
    if (!candidate.title) {
      return false;
    }
    if (normalizeTitle(candidate.title) !== normalizedPaperTitle) {
      return false;
    }
    if (paper.year && candidate.year) {
      return paper.year === candidate.year;
    }
    return true;
  });
}

export function attachExistingItems(
  groups: RecommendationGroup[],
  candidates: LibraryItemCandidate[],
) {
  return sortRecommendationGroups(
    groups.map((group) => ({
      ...group,
      papers: group.papers.map((paper) => ({
        ...paper,
        existingItemID: findExistingLibraryItem(paper, candidates)?.id,
      })),
    })),
  );
}

export function buildOpenTarget(
  paper: Pick<RecommendedPaper, "existingItemID" | "doi" | "url" | "urls">,
) {
  if (paper.existingItemID) {
    return { kind: "zotero", itemID: paper.existingItemID } as const;
  }
  const url = paper.url || paper.urls?.[0];
  if (url) {
    return { kind: "external", url } as const;
  }
  if (paper.doi) {
    return {
      kind: "external",
      url: `https://doi.org/${normalizeDOI(paper.doi)}`,
    } as const;
  }
  throw new Error(
    "No openable URL or DOI was provided for this recommendation.",
  );
}

export function buildRecommendationMetadataLine(paper: RecommendedPaper) {
  const authorText = paper.authors.slice(0, 3).join(", ");
  return [
    paper.authors.length > 3 ? `${authorText} et al.` : authorText,
    paper.year,
    paper.venue,
    paper.relationship
      ? `${paper.relationship[0].toUpperCase()}${paper.relationship.slice(1)} relationship`
      : undefined,
    paper.publicationClass
      ? paper.publicationClass.replace(/_/g, " ")
      : undefined,
    paper.evidenceConfidence
      ? `${paper.evidenceConfidence} evidence confidence`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildRelatedPaperQuestion(
  item: Pick<any, "getField" | "getCreators">,
  concern?: ResearchConcern,
  responseLanguage?: string,
) {
  return buildDiscoveryQuestion({
    item,
    concern,
    responseLanguage,
  });
}

function splitCreatorName(name: string) {
  const normalized = normalizeWhitespace(name);
  const parts = normalized.split(" ");
  const lastName = parts.pop() || normalized;
  return {
    firstName: parts.join(" "),
    lastName,
    creatorType: "author" as const,
  };
}

export function buildDiscoveryEvidenceExtra(paper: RecommendedPaper) {
  if (!paper.publicationClass && !paper.publicationEvidence?.length) return "";
  return [
    "Paper Pilot discovery evidence:",
    paper.publicationClass
      ? `Publication class: ${paper.publicationClass}`
      : undefined,
    paper.evidenceConfidence
      ? `Evidence confidence: ${paper.evidenceConfidence}`
      : undefined,
    ...(paper.publicationEvidence || []).map(
      (entry) =>
        `Evidence (${entry.type}; ${entry.supports.join(", ")}): ${entry.url}`,
    ),
    paper.reviewURL ? `Public review: ${paper.reviewURL}` : undefined,
    paper.searchConcern ? `Search concern: ${paper.searchConcern}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function getMainWindowPane() {
  const mainWindow = Zotero.getMainWindow();
  return mainWindow?.ZoteroPane;
}

function resolveCollectionReference(collection: any) {
  if (!collection) {
    return undefined;
  }
  if (typeof collection === "number") {
    return typeof Zotero.Collections.get === "function"
      ? Zotero.Collections.get(collection)
      : undefined;
  }
  if (typeof collection.addItems === "function") {
    return collection;
  }
  if (typeof collection.id === "number") {
    return typeof Zotero.Collections.get === "function"
      ? Zotero.Collections.get(collection.id) || collection
      : collection;
  }
  return undefined;
}

export async function getLibraryItemCandidates(libraryID: number) {
  const items = await Zotero.Items.getAll(libraryID, true, false, false);
  return items
    .filter((item: any) => !item.isAttachment() && !item.isNote())
    .map((item: any) => ({
      id: item.id,
      title: String(item.getField("title") || "").trim(),
      year: toOptionalYear(item.getField("year") || item.getField("date")),
      doi: toOptionalString(item.getField("DOI")),
    })) satisfies LibraryItemCandidate[];
}

export async function generateRelatedPaperGroups(params: {
  itemID: number;
  itemTitle: string;
  concern?: ResearchConcern;
  signal?: AbortSignal;
  onReserved?: () => void;
  onStatus?: (status: string) => void;
  onSuccess?: (result: {
    groups: RecommendationGroup[];
    discovery?: DiscoveryResult;
    rawOutput: string;
  }) => void | Promise<void>;
  onFailure?: (error: unknown) => void | Promise<void>;
}) {
  const mode = getModeForItem(params.itemID);
  const reservationToken = claimWorkspaceRunReservation(mode, params.itemID);
  if (!reservationToken) {
    throw new Error(
      getWorkspaceEngineActiveMessage(mode, "related-paper recommendations"),
    );
  }

  let releaseReservation = true;
  try {
    params.onReserved?.();
    const { sessionStore } = await import("./session/sessionStore");
    const { cleanupWorkspaceIfEnabled } = await import("./workspace/cleanup");
    const item = await Zotero.Items.getAsync(params.itemID);
    const session = sessionStore.touch(params.itemID, mode, params.itemTitle);
    const capabilities = getDiscoveryCapabilities(mode);
    if (!canRunDiscovery(capabilities)) {
      throw new Error(
        "Research discovery requires network-capable search. Enable web search for the active engine or make structured scholarly providers available.",
      );
    }
    params.onStatus?.("Understanding the research question");
    const seedQueries = buildStructuredSeedQueries({
      title: params.itemTitle,
      concern: params.concern?.text,
    });
    params.onStatus?.("Selecting fields and leading venues");
    const providerResults: Array<{
      seed: (typeof seedQueries)[number];
      result: Awaited<ReturnType<typeof searchCandidateProviders>>;
    }> = [];
    if (capabilities.structuredCandidateSearch) {
      for (const [index, seed] of seedQueries.entries()) {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        providerResults.push({
          seed,
          result: await searchCandidateProviders({
            query: seed.query,
            limitPerProvider: 6,
            signal: params.signal,
          }),
        });
      }
    }
    const providerResult = capabilities.structuredCandidateSearch
      ? {
          candidates: deduplicateProviderCandidates(
            providerResults.flatMap((entry) => entry.result.candidates),
          ),
          limitations: providerResults.flatMap((entry) =>
            entry.result.limitations.map(
              (limitation) => `${entry.seed.family}: ${limitation}`,
            ),
          ),
        }
      : { candidates: [], limitations: ["Structured providers unavailable."] };
    if (params.signal?.aborted)
      throw new Error("Research discovery cancelled.");
    if (!capabilities.agentWebSearch && !providerResult.candidates.length) {
      throw new Error(
        "Research discovery requires a live search path; structured providers returned no candidates and the active engine cannot search the web.",
      );
    }
    const structuredContext = [
      "Structured scholarly candidates (candidate discovery only; not acceptance evidence):",
      `Structured query families: ${JSON.stringify(seedQueries)}`,
      "<structured_candidates>",
      JSON.stringify(providerResult.candidates.slice(0, 40)),
      "</structured_candidates>",
      providerResult.limitations.length
        ? `Unavailable candidate sources: ${providerResult.limitations.join(" | ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    params.onStatus?.("Searching scholarly sources");

    const result = await startWorkspaceTextRun({
      mode,
      itemID: params.itemID,
      reservationItemID: params.itemID,
      reservationToken,
      title: params.itemTitle,
      sessionId: session.sessionId,
      question: `${buildRelatedPaperQuestion(
        item,
        params.concern,
        normalizeResponseLanguage(getPref("responseLanguage")),
      )}\n${structuredContext}`,
    }).catch(() => {
      throw new Error(
        `${getWorkspaceEngineLabel(mode)} related-paper run could not start.`,
      );
    });

    if (!result.ok) {
      await cleanupWorkspaceIfEnabled(result.workspacePath);
      throw new Error(
        `${getWorkspaceEngineLabel(mode)} related-paper run could not start.`,
      );
    }

    let attempts = 0;
    let completed = false;
    let recommendationResult:
      | {
          groups: RecommendationGroup[];
          discovery?: DiscoveryResult;
          rawOutput: string;
        }
      | undefined;
    let runError: unknown;
    try {
      while (attempts < 300) {
        if (params.signal?.aborted) {
          throw new Error("Research discovery cancelled.");
        }
        const progress = await readWorkspaceRunProgress(mode, {
          outputPath: result.outputPath,
          stderrPath: result.stderrPath,
          exitCodePath: result.exitCodePath,
        });
        if (progress.completed) {
          completed = true;
          const responseText = extractWorkspaceRunText(mode, progress);
          if (progress.exitCode !== "0") {
            throw new Error(responseText || "Related paper generation failed.");
          }
          params.onStatus?.("Verifying publication status");
          let parsed = parseRelatedPaperResponse(responseText);
          if (parsed.discovery && capabilities.officialEvidenceFetch) {
            const discovery = await verifyDiscoveryEvidenceLive({
              discovery: parsed.discovery,
              signal: params.signal,
            });
            parsed = {
              discovery,
              groups: discoveryResultToRecommendationGroups(discovery),
            };
          }
          params.onStatus?.("Analyzing relevance and novelty");
          const candidates = await getLibraryItemCandidates(item.libraryID);
          params.onStatus?.("Preparing results");
          recommendationResult = {
            groups: attachExistingItems(parsed.groups, candidates),
            discovery: parsed.discovery,
            rawOutput: progress.rawOutput,
          };
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 800));
        attempts += 1;
      }

      if (!completed) {
        throw new Error(
          "Timed out while waiting for related paper recommendations.",
        );
      }
    } catch (error) {
      runError = error;
    }

    let stopError: unknown;
    if (!completed) {
      try {
        await stopDetachedRunProcess(result.processId, {
          requireProcessId: true,
        });
      } catch (error) {
        stopError = error;
      }
    }
    if (stopError) {
      releaseReservation = false;
      throw new Error(
        `${getWorkspaceEngineLabel(mode)} related-paper process could not be stopped. Its workspace remains reserved until Zotero restarts.`,
      );
    }
    await cleanupWorkspaceIfEnabled(result.workspacePath);
    if (runError) throw runError;
    if (!recommendationResult) {
      throw new Error("Related paper generation produced no result.");
    }
    await params.onSuccess?.(recommendationResult);
    return recommendationResult;
  } catch (error) {
    await params.onFailure?.(error);
    throw error;
  } finally {
    if (releaseReservation) {
      releaseWorkspaceRunReservation(params.itemID, reservationToken);
    }
  }
}

export async function generatePublicReviewInsight(params: {
  itemID: number;
  itemTitle: string;
  paper: RecommendedPaper;
  onStatus?: (status: string) => void;
}) {
  if (!params.paper.reviewURL) {
    throw new Error("No public review source is available for this paper.");
  }
  const mode = getModeForItem(params.itemID);
  if (!getDiscoveryCapabilities(mode).agentWebSearch) {
    throw new Error(
      "Public review insight requires agent web search. Enable web search for the active engine and try again.",
    );
  }
  const reservationToken = claimWorkspaceRunReservation(mode, params.itemID);
  if (!reservationToken) {
    throw new Error(getWorkspaceEngineActiveMessage(mode, "review insights"));
  }

  let releaseReservation = true;
  try {
    const { sessionStore } = await import("./session/sessionStore");
    const { cleanupWorkspaceIfEnabled } = await import("./workspace/cleanup");
    const session = sessionStore.touch(params.itemID, mode, params.itemTitle);
    params.onStatus?.("Reading public reviews…");
    const result = await startWorkspaceTextRun({
      mode,
      itemID: params.itemID,
      reservationItemID: params.itemID,
      reservationToken,
      title: params.itemTitle,
      sessionId: session.sessionId,
      question: buildPublicReviewInsightQuestion({
        title: params.paper.title,
        venue: params.paper.venue,
        reviewURL: params.paper.reviewURL,
        responseLanguage: normalizeResponseLanguage(
          getPref("responseLanguage"),
        ),
      }),
    });
    if (!result.ok) {
      await cleanupWorkspaceIfEnabled(result.workspacePath);
      throw new Error("Public-review analysis could not start.");
    }

    let completed = false;
    let insight: PublicReviewInsight | undefined;
    let runError: unknown;
    try {
      for (let attempts = 0; attempts < 300; attempts += 1) {
        const progress = await readWorkspaceRunProgress(mode, {
          outputPath: result.outputPath,
          stderrPath: result.stderrPath,
          exitCodePath: result.exitCodePath,
        });
        if (progress.completed) {
          completed = true;
          const responseText = extractWorkspaceRunText(mode, progress);
          if (progress.exitCode !== "0") {
            throw new Error(responseText || "Public-review analysis failed.");
          }
          insight = parsePublicReviewInsight(responseText);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (!completed) {
        throw new Error("Timed out while reading public reviews.");
      }
    } catch (error) {
      runError = error;
    }

    if (!completed) {
      try {
        await stopDetachedRunProcess(result.processId, {
          requireProcessId: true,
        });
      } catch {
        releaseReservation = false;
        throw new Error(
          `${getWorkspaceEngineLabel(mode)} review process could not be stopped. Its workspace remains reserved until Zotero restarts.`,
        );
      }
    }
    await cleanupWorkspaceIfEnabled(result.workspacePath);
    if (runError) throw runError;
    if (!insight) throw new Error("Public-review analysis produced no result.");
    return insight;
  } finally {
    if (releaseReservation) {
      releaseWorkspaceRunReservation(params.itemID, reservationToken);
    }
  }
}

export async function openRecommendedPaper(paper: RecommendedPaper) {
  const target = buildOpenTarget(paper);
  if (target.kind === "zotero") {
    const pane = getMainWindowPane();
    if (!pane) {
      throw new Error("Zotero pane is unavailable.");
    }
    const tabs = (
      globalThis as { Zotero_Tabs?: { select: (id: string) => void } }
    ).Zotero_Tabs;
    tabs?.select?.("zotero-pane");
    await pane.selectItem(target.itemID);
    return;
  }

  Zotero.launchURL(target.url);
}

function buildCollectionOptionLabel(collection: any) {
  const parts = [collection.name];
  let parentID = collection.parentID;
  while (parentID) {
    const parent = Zotero.Collections.get(parentID);
    if (!parent) {
      break;
    }
    parts.unshift(parent.name);
    parentID = parent.parentID;
  }
  return parts.join(" / ");
}

export async function chooseCollectionForRecommendation(sourceItem: any) {
  const pane = getMainWindowPane();
  const selectedCollection = resolveCollectionReference(
    pane?.getSelectedCollection?.(),
  );
  if (selectedCollection) {
    return selectedCollection;
  }

  const collections = Zotero.Collections.getByLibrary(
    sourceItem.libraryID,
    true,
  );
  if (!collections.length) {
    return undefined;
  }
  if (collections.length === 1) {
    return collections[0];
  }

  const promptService = (
    globalThis as {
      Services?: { prompt?: { select: (...args: unknown[]) => boolean } };
    }
  ).Services?.prompt;
  if (!promptService?.select) {
    return collections[0];
  }

  const selected = { value: 0 };
  const confirmed = promptService.select(
    null,
    "Add related paper to collection",
    "Choose a collection",
    collections.length,
    collections.map(buildCollectionOptionLabel),
    selected,
  );

  return confirmed ? collections[selected.value] : undefined;
}

export async function addRecommendationToCollection(params: {
  sourceItemID: number;
  paper: RecommendedPaper;
}) {
  const sourceItem = await Zotero.Items.getAsync(params.sourceItemID);
  const collection = await chooseCollectionForRecommendation(sourceItem);
  if (!collection) {
    throw new Error(
      "Select or create a Zotero collection before adding a related paper.",
    );
  }

  const existingCandidate = params.paper.existingItemID
    ? { id: params.paper.existingItemID }
    : findExistingLibraryItem(
        params.paper,
        await getLibraryItemCandidates(sourceItem.libraryID),
      );
  const existing = existingCandidate
    ? Zotero.Items.get(existingCandidate.id)
    : undefined;

  const item = existing || new Zotero.Item("journalArticle");
  let needsSave = false;
  if (!existing) {
    item.libraryID = sourceItem.libraryID;
    item.setField("title", params.paper.title);
    if (params.paper.year) {
      item.setField("date", String(params.paper.year));
    }
    if (params.paper.venue) {
      item.setField("publicationTitle", params.paper.venue);
    }
    if (params.paper.doi) {
      item.setField("DOI", normalizeDOI(params.paper.doi));
    }
    if (params.paper.url) {
      item.setField("url", params.paper.url);
    }
    if (params.paper.abstract) {
      item.setField("abstractNote", params.paper.abstract);
    }
    if (params.paper.authors.length) {
      item.setCreators(params.paper.authors.map(splitCreatorName));
    }
    needsSave = true;
  }

  const evidenceExtra = buildDiscoveryEvidenceExtra(params.paper);
  if (evidenceExtra) {
    const existingExtra = String(item.getField("extra") || "").trim();
    if (!existingExtra.includes(evidenceExtra)) {
      item.setField(
        "extra",
        [existingExtra, evidenceExtra].filter(Boolean).join("\n\n"),
      );
      needsSave = true;
    }
  }
  if (needsSave) {
    await item.saveTx();
  }

  if (
    typeof collection.hasItem !== "function" ||
    !collection.hasItem(item.id)
  ) {
    await collection.addItems([item.id]);
  }

  return {
    itemID: item.id,
    collectionID: collection.id,
    reusedExistingItem: Boolean(existing),
  };
}
