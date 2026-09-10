import {
  buildPaperContentFingerprint,
  paperWorkspaceContentCache,
  type PaperWorkspaceContentSource,
} from "../tools/paperWorkspaceContent";
import type { WorkspaceSupplementalFiles } from "../workspace/supplementalFiles";

declare const Zotero: any;

export interface RequestAnnotationSnapshot {
  key: string;
  quote: string;
  comment: string;
  pageIndex?: number;
  pageLabel?: string;
  position?: unknown;
  sourceID: string;
  kind: string;
}

export interface RequestContextSnapshot {
  sourceID: string;
  source: PaperWorkspaceContentSource;
  itemID: number;
  attachmentID: number;
  paperTitle: string;
  contentFingerprint: string;
  capturedAt: string;
  selectedText?: string;
  pageIndex?: number;
  pageLabel?: string;
  annotations: RequestAnnotationSnapshot[];
  warnings: string[];
}

export interface PrebuiltWorkspaceInput {
  files: WorkspaceSupplementalFiles;
  sourceIDs: readonly string[];
  scopeFingerprint: string;
  artifactIDs?: readonly string[];
}

function isPDF(item: any) {
  return (
    Boolean(item?.isAttachment?.()) &&
    ["application/pdf", ""].includes(String(item.attachmentContentType ?? ""))
  );
}

function pageIndex(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function parsePosition(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function availableAttachmentPath(attachment: any): Promise<string> {
  const filePath = await attachment.getFilePathAsync?.();
  const io = (
    globalThis as typeof globalThis & {
      IOUtils?: { exists?: (path: string) => Promise<boolean> };
    }
  ).IOUtils;
  if (!filePath || (io?.exists && !(await io.exists(filePath))))
    throw new Error(
      "The original PDF file is unavailable. Restore or select the PDF before continuing.",
    );
  return filePath;
}

/** Capture the exact reader/attachment once; never consult a later active tab. */
export async function captureRequestContext(params: {
  itemID: number;
  attachmentID?: number;
  reader?: any;
  selectedText?: string;
  pageIndex?: number;
  pageLabel?: string;
  annotationIDs?: readonly string[];
}): Promise<RequestContextSnapshot> {
  // Read UI values synchronously before source/fingerprint awaits. A later reader
  // selection must not silently replace the context the user just submitted.
  const readerAttachmentID = Number(
    params.reader?._item?.id ?? params.reader?.itemID,
  );
  const readerMatches =
    params.attachmentID === undefined ||
    params.attachmentID === readerAttachmentID;
  const selection = readerMatches
    ? params.reader?._internalReader?._lastView?._selectionPopup?.annotation
    : undefined;
  const stats = readerMatches
    ? params.reader?._state?.primaryViewStats
    : undefined;
  const capturedSelectionText =
    typeof selection?.text === "string" ? selection.text : undefined;
  const capturedPageIndex = pageIndex(
    params.pageIndex ?? selection?.position?.pageIndex ?? stats?.pageIndex,
  );
  const capturedPageLabel = String(
    params.pageLabel ?? selection?.pageLabel ?? stats?.pageLabel ?? "",
  );
  const requested = await Zotero.Items.getAsync(params.itemID);
  if (!requested)
    throw new Error("The requested paper is no longer available.");
  const explicitID =
    params.attachmentID ??
    (Number.isInteger(readerAttachmentID) ? readerAttachmentID : undefined);
  let attachment = explicitID
    ? await Zotero.Items.getAsync(explicitID)
    : undefined;
  if (explicitID !== undefined && !attachment)
    throw new Error(
      "The explicitly selected PDF is no longer available. Select it again.",
    );
  if (!attachment && isPDF(requested)) attachment = requested;
  if (!attachment) {
    const pdfs = (requested.getAttachments?.() ?? [])
      .map((id: number) => Zotero.Items.get(id))
      .filter(isPDF);
    if (pdfs.length !== 1)
      throw new Error(
        pdfs.length
          ? "Choose the exact PDF before asking about this paper."
          : "This paper has no available PDF attachment.",
      );
    attachment = pdfs[0];
  }
  if (!isPDF(attachment))
    throw new Error("The selected attachment is not a PDF.");
  const parentID = Number(attachment.parentItemID) || Number(attachment.id);
  if (
    Number(requested.id) !== Number(attachment.id) &&
    Number(requested.id) !== parentID
  )
    throw new Error("The selected PDF does not belong to this paper.");
  const item =
    parentID === Number(attachment.id)
      ? attachment
      : await Zotero.Items.getAsync(parentID);
  if (!item) throw new Error("The selected PDF's paper is unavailable.");
  const source: PaperWorkspaceContentSource = {
    libraryID: Number(attachment.libraryID),
    itemKey: String(item.key || ""),
    attachmentKey: String(attachment.key || ""),
    standaloneAttachment: item.id === attachment.id,
  };
  if (
    !Number.isInteger(source.libraryID) ||
    source.libraryID <= 0 ||
    !source.itemKey ||
    !source.attachmentKey
  )
    throw new Error("The PDF has no stable library/source identity.");
  const sourceID = `zotero:${source.libraryID}:${source.itemKey}:${source.attachmentKey}`;
  const fingerprint = await buildPaperContentFingerprint(
    attachment,
    await availableAttachmentPath(attachment),
  );
  const annotations: RequestAnnotationSnapshot[] = [];
  const warnings: string[] = [];
  const available = params.annotationIDs?.length
    ? await Promise.resolve(attachment.getAnnotations?.() ?? [])
    : [];
  for (const id of params.annotationIDs ?? []) {
    const annotation = available.find(
      (entry: any) =>
        String(entry.key) === String(id) || String(entry.id) === String(id),
    );
    if (
      !annotation ||
      Number(annotation.parentItemID) !== Number(attachment.id)
    ) {
      warnings.push(
        "A selected annotation is missing from this PDF and was excluded.",
      );
      continue;
    }
    const position = parsePosition(annotation.annotationPosition);
    const kind = String(annotation.annotationType || "highlight");
    if (kind === "image")
      warnings.push(
        "Image annotation pixels are not included; only its comment and location are available.",
      );
    annotations.push({
      key: String(annotation.key),
      quote: String(annotation.annotationText || ""),
      comment: String(annotation.annotationComment || ""),
      pageIndex: pageIndex(position?.pageIndex),
      pageLabel: String(annotation.annotationPageLabel || ""),
      position,
      sourceID,
      kind,
    });
  }
  if (params.annotationIDs?.length && !annotations.length)
    throw new Error(
      "The selected annotations could not be read. Select them again in the intended PDF.",
    );
  return {
    sourceID,
    source,
    itemID: Number(item.id),
    attachmentID: Number(attachment.id),
    paperTitle: String(item.getField?.("title") || ""),
    contentFingerprint: fingerprint.value,
    capturedAt: new Date().toISOString(),
    selectedText: params.selectedText ?? capturedSelectionText,
    pageIndex: capturedPageIndex,
    pageLabel: capturedPageLabel,
    annotations,
    warnings,
  };
}

async function resolveSnapshotItems(snapshot: RequestContextSnapshot) {
  if (
    snapshot.sourceID !==
    `zotero:${snapshot.source.libraryID}:${snapshot.source.itemKey}:${snapshot.source.attachmentKey}`
  )
    throw new Error("The saved source identity is inconsistent.");
  const attachment = await Zotero.Items.getAsync(snapshot.attachmentID);
  const item = await Zotero.Items.getAsync(snapshot.itemID);
  if (
    !isPDF(attachment) ||
    !item ||
    Number(attachment.libraryID) !== snapshot.source.libraryID ||
    String(attachment.key) !== snapshot.source.attachmentKey ||
    String(item.key) !== snapshot.source.itemKey ||
    Number(item.libraryID) !== snapshot.source.libraryID ||
    (Number(attachment.parentItemID) || Number(attachment.id)) !==
      Number(item.id)
  )
    throw new Error(
      "The original PDF source is no longer available. Select the source again.",
    );
  const fingerprint = await buildPaperContentFingerprint(
    attachment,
    await availableAttachmentPath(attachment),
  );
  if (
    !matchesRequestContentFingerprint(
      fingerprint.value,
      snapshot.contentFingerprint,
    )
  )
    throw new Error(
      "The PDF changed since this question was prepared. Capture its context again.",
    );
  return { item, attachment };
}

/** v1 attachment versions can change on sync without changing PDF metadata. */
export function matchesRequestContentFingerprint(
  current: string,
  saved: string,
) {
  if (current === saved) return true;
  const parse = (value: string) =>
    /^(\d+):(\d+):(\d+):(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/.exec(value);
  const a = parse(current);
  const b = parse(saved);
  if (!a || !b) return false;
  if (
    ![a[1], a[2], a[3], b[1], b[2], b[3]].every((value) =>
      Number.isSafeInteger(Number(value)),
    )
  )
    return false;
  return a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
}

export async function assertRequestContextCurrent(
  snapshot: RequestContextSnapshot,
): Promise<void> {
  await resolveSnapshotItems(snapshot);
}

export async function readRequestPaperContent(
  snapshot: RequestContextSnapshot,
) {
  const { item, attachment } = await resolveSnapshotItems(snapshot);
  const content = await paperWorkspaceContentCache.getPaperContent(item, {
    attachment,
    source: snapshot.source,
  });
  await assertRequestContextCurrent(snapshot);
  return { item, attachment, content };
}

export interface RunTimings {
  admittedAt?: number;
  sourceCapturedAt?: number;
  userTurnPersistedAt?: number;
  preparingAt: number;
  extractionStartedAt?: number;
  extractionCompletedAt?: number;
  contextReadyAt?: number;
  spawnedAt?: number;
  firstAssistantAt?: number;
  finishedAt?: number;
  persistedAt?: number;
  displayedAt?: number;
}

export async function prepareRunInput(params: {
  itemID: number;
  sessionId: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  requestContext?: RequestContextSnapshot;
  prebuiltInput?: PrebuiltWorkspaceInput;
  workspaceFiles?: WorkspaceSupplementalFiles;
  settings: import("../ai/executionSettings").ExecutionSettings;
  timings: RunTimings;
  includeConversation?: boolean;
  responseLength?: "short" | "default" | "detailed";
}) {
  const { buildWorkspaceArtifacts } = await import("./workspaceArtifacts");
  const { buildContextPayload } = await import("./promptPreviewBuilder");
  if (params.prebuiltInput) {
    if (params.workspaceFiles)
      throw new Error(
        "Provide one admitted workspace input, not two overlapping file sets.",
      );
    if (!params.prebuiltInput.sourceIDs.length)
      throw new Error("The admitted workspace has no sources.");
    const names = Object.keys(params.prebuiltInput.files);
    if (
      names.some((name) =>
        /(^|\/)(?:paperpilot-input-manifest\.json|(?:codex|claude|gemini)-(?:output|stderr|exit|pid)|prompt\.txt)/.test(
          name,
        ),
      )
    )
      throw new Error("Admitted project files use a reserved run filename.");
    const files: Record<string, string> = {
      ...params.prebuiltInput.files,
      "CONTEXT_INDEX.md": [
        "# Admitted project input",
        "Read only this run's supplied sources and artifacts. Do not look for a parent paper or a different PDF.",
        ...names.map((name) => `- ${name}`),
      ].join("\n"),
    };
    params.timings.contextReadyAt = Date.now();
    return {
      files,
      promptPreview: buildContextPayload({
        question: params.question,
        responseLanguage: params.settings.responseLanguage,
      }).promptPreview,
      sourceIDs: params.prebuiltInput.sourceIDs,
      artifactIDs: params.prebuiltInput.artifactIDs ?? [],
      scopeFingerprint: params.prebuiltInput.scopeFingerprint,
      requestContext: undefined,
    };
  }
  const context =
    params.requestContext ??
    (await captureRequestContext({
      itemID: params.itemID,
      selectedText: params.selectedText,
      annotationIDs: params.annotationIDs,
    }));
  params.timings.extractionStartedAt = Date.now();
  const { item, content } = await readRequestPaperContent(context);
  params.timings.extractionCompletedAt = Date.now();
  const { getPref } = await import("../../utils/prefs");
  const { findNearbyContext } = await import("./nearbyContext");
  const { getIndexedChunks } = await import("./indexStore");
  const { selectRelevantChunksFromChunks } = await import("./retriever");
  const selectionText =
    context.selectedText ||
    context.annotations
      .map((entry) => [entry.quote, entry.comment].filter(Boolean).join("\n"))
      .join("\n\n") ||
    undefined;
  const payload = buildContextPayload({
    question: params.question,
    responseLanguage: params.settings.responseLanguage,
    selectedText: selectionText,
    pageNumber: context.pageIndex,
    annotationIDs: context.annotations.map((entry) => entry.key),
  });
  payload.surroundingText = getPref("retrievalIncludeNearbyContext")
    ? findNearbyContext({
        fullText: content.fullText,
        selectedText: selectionText,
        pageIndex: context.pageIndex,
      })
    : undefined;
  payload.retrievedChunks = selectRelevantChunksFromChunks(
    getIndexedChunks({
      libraryID: context.source.libraryID,
      itemKey: `${context.source.itemKey}:${context.source.attachmentKey}`,
      text: content.fullText,
      chunkSize: Number(getPref("retrievalChunkSize") || 1100),
      overlapSize: Number(getPref("retrievalOverlapSize") || 200),
    }),
    [params.question, selectionText].filter(Boolean).join("\n"),
    Number(getPref("retrievalTopK") || 5),
  );
  const authors = (item.getCreators?.() ?? []).map(
    (creator: { firstName?: string; lastName?: string }) =>
      [creator.firstName, creator.lastName].filter(Boolean).join(" "),
  );
  const { messageStore } = await import("../message/messageStore");
  const artifacts = buildWorkspaceArtifacts({
    title: context.paperTitle,
    authors,
    year: String(item.getField?.("year") || ""),
    itemKey: context.source.itemKey,
    attachmentKey: context.source.attachmentKey,
    abstractNote: getPref("retrievalIncludeAbstract")
      ? String(item.getField?.("abstractNote") || "")
      : "",
    fullText: content.fullText,
    markdownText: content.markdownText,
    structuredContent: content.structuredContent,
    extractionMethod: content.extractionMethod,
    extractionNotes: content.extractionNotes,
    payload,
    annotations: context.annotations,
    recentTurns:
      params.includeConversation === false
        ? []
        : messageStore
            .recentForWorkspace(params.sessionId, 3)
            .map(({ role, text, createdAt }) => ({ role, text, createdAt })),
    requestText: params.question,
  });
  if (params.includeConversation !== false) {
    const { buildChatAnswerInstructions } = await import(
      "../message/chatAnswer"
    );
    payload.promptPreview += `\n${buildChatAnswerInstructions()}\nAllowed citation source: ${context.sourceID}\nResponse length: ${params.responseLength || "default"}.`;
  }
  const files: Record<string, string> = {
    "paper.md": artifacts.paperMarkdownText,
    "paper.txt": artifacts.paperText,
    "paper.json": JSON.stringify(artifacts.paperJson, null, 2),
    "metadata.json": JSON.stringify(
      {
        ...artifacts.metadata,
        sourceID: context.sourceID,
        contentFingerprint: context.contentFingerprint,
        imageInput: "text-only",
      },
      null,
      2,
    ),
    "selection.json": JSON.stringify(
      {
        ...artifacts.selection,
        sourceID: context.sourceID,
        pageIndex: context.pageIndex,
        pageLabel: context.pageLabel,
      },
      null,
      2,
    ),
    "annotations.json": JSON.stringify(context.annotations, null, 2),
    "recent-turns.json": "[]",
    "CONTEXT_INDEX.md": artifacts.contextIndexText,
  };
  if (params.includeConversation !== false) {
    const { buildSessionContinuity } = await import("../session/continuity");
    files["conversation-context.md"] = buildSessionContinuity({
      sessionId: params.sessionId,
      sourceFingerprint: context.contentFingerprint,
    }).text;
    files["CONTEXT_INDEX.md"] +=
      "\n- conversation-context.md — privacy-eligible pinned context, summary and completed turns. Read for follow-up continuity.";
  }
  if (artifacts.discoveryArtifacts) {
    for (const [name, value] of Object.entries(artifacts.discoveryArtifacts))
      files[`discovery-${name}.json`] = JSON.stringify(value, null, 2);
  }
  for (const [name, value] of Object.entries(params.workspaceFiles ?? {})) {
    if (name in files)
      throw new Error(
        "Supplemental inputs cannot replace the captured paper context.",
      );
    files[name] = value;
  }
  params.timings.contextReadyAt = Date.now();
  return {
    files,
    promptPreview: payload.promptPreview,
    sourceIDs: [context.sourceID],
    artifactIDs: [] as string[],
    scopeFingerprint: context.contentFingerprint,
    requestContext: context,
  };
}
