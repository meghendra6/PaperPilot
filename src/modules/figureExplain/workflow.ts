import { extractPdfTextPages } from "../autoHighlight/pdfMatch";
import { captureExecutionSettings } from "../ai/executionSettings";
import { getModeForItem } from "../ai/modeStore";
import { classifyRunFailure, getEngineLabel } from "../ai/runFailure";
import { isWorkspaceRunActiveForItem } from "../ai/workspaceRun";
import { captureRequestContext } from "../context/requestContext";
import {
  runResearchWorkspaceAnalysis,
  WorkspaceAnalysisRunError,
} from "../researchWorkspace/analysisRunner";
import { locateFigureContext, normalizePdfRect } from "./locator";
import {
  buildFigureExplainQuestion,
  buildFigureRequestFile,
  FIGURE_EXPLANATION_OUTPUT_SCHEMA,
  FIGURE_REQUEST_FILE,
} from "./prompt";
import { parseFigureExplanationResponse } from "./response";
import type {
  FigureExplanation,
  FigureLocatorHints,
  FigureRegion,
} from "./types";

declare const Zotero: any;
declare const IOUtils: any;

const MAX_CACHED_EXPLANATIONS = 24;
/** The reader saves a new area's PNG shortly after the annotation itself. */
const NEW_IMAGE_WAIT_MS = 2_500;
const NEW_IMAGE_POLL_MS = 250;
const RESERVATION_POLL_MS = 250;

/** One image annotation, named by stable keys rather than a live selection. */
export interface FigureExplainTarget {
  attachmentID: number;
  annotationKey: string;
}

export interface PreparedFigure {
  /** Zotero's cached PNG of the area, or undefined for a text-only run. */
  imagePath?: string;
  hints: FigureLocatorHints;
}

export interface FigureExplainResult {
  explanation: FigureExplanation;
  engineLabel: string;
  hasImage: boolean;
  cached: boolean;
}

function isImageAnnotation(annotation: any) {
  return String(annotation?.annotationType || "") === "image";
}

function findAnnotation(attachment: any, annotationKey: string) {
  const annotations: any[] = attachment?.getAnnotations?.() ?? [];
  return annotations.find((entry) => String(entry?.key) === annotationKey);
}

/**
 * Returns a target when the IDs name exactly one area annotation of this PDF.
 * Reader context menus pass annotation keys as IDs.
 */
export function resolveFigureTarget(
  attachment: any,
  annotationIDs: readonly string[] | undefined,
): FigureExplainTarget | undefined {
  if (annotationIDs?.length !== 1 || !attachment?.isPDFAttachment?.())
    return undefined;
  const annotationKey = String(annotationIDs[0]);
  return isImageAnnotation(findAnnotation(attachment, annotationKey))
    ? { attachmentID: Number(attachment.id), annotationKey }
    : undefined;
}

export async function resolveFigureRegion(
  target: FigureExplainTarget,
): Promise<FigureRegion> {
  const attachment = await Zotero.Items.getAsync(target.attachmentID);
  if (!attachment?.isPDFAttachment?.())
    throw new Error("The selected area is not in an available PDF.");
  const annotation = findAnnotation(attachment, target.annotationKey);
  if (!annotation)
    throw new Error("The selected area annotation no longer exists.");
  if (!isImageAnnotation(annotation))
    throw new Error(
      "Select the figure or table with Zotero's Select Area tool first.",
    );
  let position: { pageIndex?: unknown; rects?: unknown[] } | undefined;
  try {
    position = JSON.parse(String(annotation.annotationPosition || "{}"));
  } catch {
    position = undefined;
  }
  const pageIndex = Number(position?.pageIndex);
  const rect = normalizePdfRect(position?.rects?.[0]);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || !rect)
    throw new Error("The selected area has no readable page position.");
  return {
    itemID: Number(attachment.parentItemID) || Number(attachment.id),
    attachmentID: Number(attachment.id),
    libraryID: Number(attachment.libraryID),
    annotationKey: target.annotationKey,
    pageIndex,
    pageLabel: String(annotation.annotationPageLabel || pageIndex + 1),
    rect,
    comment: String(annotation.annotationComment || "").trim(),
    dateModified: String(annotation.dateModified || ""),
  };
}

function logError(error: unknown) {
  Zotero.logError?.(error instanceof Error ? error : new Error(String(error)));
}

/** Zotero keeps a PNG per area annotation and renders missing ones on request. */
async function resolveFigureImage(region: FigureRegion) {
  const annotations = Zotero.Annotations;
  if (typeof annotations?.getCacheImagePath !== "function") return undefined;
  const path = String(
    annotations.getCacheImagePath({
      libraryID: region.libraryID,
      key: region.annotationKey,
    }),
  );
  for (
    const deadline = Date.now() + NEW_IMAGE_WAIT_MS;
    Date.now() < deadline;
    await Zotero.Promise.delay(NEW_IMAGE_POLL_MS)
  ) {
    if (await IOUtils.exists(path)) return path;
  }
  try {
    await Zotero.PDFWorker?.renderAttachmentAnnotations?.(region.attachmentID);
  } catch (error) {
    logError(error);
  }
  return (await IOUtils.exists(path)) ? path : undefined;
}

async function collectFigureHints(
  region: FigureRegion,
): Promise<FigureLocatorHints> {
  try {
    const attachment = await Zotero.Items.getAsync(region.attachmentID);
    const filePath = await attachment?.getFilePathAsync?.();
    if (!filePath) return {};
    const page = (await extractPdfTextPages(filePath)).find(
      (entry) => entry.pageIndex === region.pageIndex,
    );
    return page ? locateFigureContext(page.spans, region.rect) : {};
  } catch (error) {
    // Hints only focus the engine; the run still has the image and paper.
    logError(error);
    return {};
  }
}

export async function prepareFigure(
  region: FigureRegion,
): Promise<PreparedFigure> {
  const [imagePath, hints] = await Promise.all([
    resolveFigureImage(region).catch((error) => {
      logError(error);
      return undefined;
    }),
    collectFigureHints(region),
  ]);
  return { imagePath, hints };
}

function explanationCache() {
  addon.data.figureExplanations ??= new Map();
  return addon.data.figureExplanations;
}

function failureMessage(error: WorkspaceAnalysisRunError) {
  const failure = classifyRunFailure({
    engine: error.mode,
    rawError: error.diagnosticOutput,
    source: "process_exit",
  });
  return failure.kind === "unknown"
    ? `${getEngineLabel(error.mode)} could not explain this area. Retry, or check the engine in Paper Pilot settings.`
    : failure.userMessage;
}

/**
 * Runs one read-only analysis for the area. Results stay in memory only and
 * are reused for the same annotation revision and execution settings.
 */
export async function explainFigure(params: {
  region: FigureRegion;
  prepared: PreparedFigure;
  force?: boolean;
  /**
   * After an abort during preparation, cleanup releases the paper's engine
   * reservation later. Wait this long for it instead of failing as "busy".
   */
  reservationWaitMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}): Promise<FigureExplainResult> {
  const { region, prepared } = params;
  const settings = captureExecutionSettings(getModeForItem(region.itemID));
  const engineLabel = getEngineLabel(settings.mode);
  const hasImage = Boolean(prepared.imagePath);
  const cacheKey = JSON.stringify([
    region.libraryID,
    region.annotationKey,
    region.dateModified,
    hasImage,
    settings.mode,
    settings.model,
    settings.reasoningEffort ?? "",
    settings.responseLanguage,
  ]);
  const cache = explanationCache();
  const cached = params.force ? undefined : cache.get(cacheKey);
  if (cached)
    return { explanation: cached, engineLabel, hasImage, cached: true };

  const waitUntil = Date.now() + (params.reservationWaitMs ?? 0);
  if (isWorkspaceRunActiveForItem(settings.mode, region.itemID))
    params.onStatus?.("Waiting for the previous run to stop…");
  while (
    Date.now() < waitUntil &&
    !params.signal?.aborted &&
    isWorkspaceRunActiveForItem(settings.mode, region.itemID)
  )
    await Zotero.Promise.delay(RESERVATION_POLL_MS);

  const requestContext = await captureRequestContext({
    itemID: region.itemID,
    attachmentID: region.attachmentID,
    pageIndex: region.pageIndex,
    pageLabel: region.pageLabel,
    annotationIDs: [region.annotationKey],
  });
  let text: string;
  try {
    text = await runResearchWorkspaceAnalysis({
      itemID: region.itemID,
      itemTitle: requestContext.paperTitle,
      purpose: "figure-explain",
      prompt: buildFigureExplainQuestion({
        hasImage,
        responseLanguage: settings.responseLanguage,
      }),
      outputSchema: FIGURE_EXPLANATION_OUTPUT_SCHEMA,
      workspaceFiles: {
        [FIGURE_REQUEST_FILE]: buildFigureRequestFile({
          region,
          hints: prepared.hints,
          hasImage,
        }),
      },
      requestContext,
      imagePath: prepared.imagePath,
      executionSettings: settings,
      signal: params.signal,
      onStatus: params.onStatus,
      taskLabel: "a figure explanation",
    });
  } catch (error) {
    if (error instanceof WorkspaceAnalysisRunError)
      throw new Error(failureMessage(error));
    throw error;
  }
  const explanation = parseFigureExplanationResponse(text);
  cache.delete(cacheKey);
  cache.set(cacheKey, explanation);
  while (cache.size > MAX_CACHED_EXPLANATIONS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return { explanation, engineLabel, hasImage, cached: false };
}
