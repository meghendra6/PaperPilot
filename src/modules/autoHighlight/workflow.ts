import {
  buildHighlightAnnotationJSON,
  isDuplicateHighlight,
} from "./annotation";
import {
  buildAutoHighlightQuestion,
  DEFAULT_AUTO_HIGHLIGHT_LIMIT,
} from "./prompt";
import { parseHighlightCandidatesWithRepair } from "./response";
import {
  extractPdfTextPages,
  extractPdfTextPagesFromReader,
  matchQuoteInPages,
} from "./pdfMatch";
import { formatAutoHighlightSummary } from "./status";
import type { AutoHighlightResult } from "./types";
import { parseCodexOutputText } from "../codex/outputParser";
import {
  readCodexRunProgress,
  startCodexRunForQuestion,
} from "../codex/runner";
import { cleanupWorkspaceIfEnabled } from "../workspace/cleanup";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveReader() {
  const toolkitReader = await ztoolkit.Reader.getReader().catch(
    () => undefined,
  );
  if (toolkitReader?.itemID) {
    return toolkitReader;
  }

  const selectedTabID = Zotero.getMainWindow?.()?.Zotero_Tabs?.selectedID;
  if (selectedTabID && typeof Zotero.Reader?.getByTabID === "function") {
    return Zotero.Reader.getByTabID(selectedTabID);
  }

  return undefined;
}

async function waitForCodexText(params: {
  itemID: number;
  title: string;
  question: string;
  onStatus?: (status: string) => void;
}) {
  const started = await startCodexRunForQuestion({
    itemID: params.itemID,
    title: params.title,
    sessionId: `auto-highlight-${params.itemID}`,
    question: params.question,
    useResume: false,
  });

  if (!started.ok) {
    await cleanupWorkspaceIfEnabled(started.workspacePath);
    throw new Error(started.error);
  }

  let completed = false;
  try {
    for (let attempts = 0; attempts < 300; attempts += 1) {
      const progress = await readCodexRunProgress({
        outputPath: started.outputPath,
        exitCodePath: started.exitCodePath,
      });

      if (progress.completed) {
        completed = true;
        const parsedText =
          parseCodexOutputText(progress.rawOutput) || progress.rawOutput;
        if (progress.exitCode !== "0") {
          throw new Error(parsedText || "Codex highlight run failed.");
        }
        return parsedText;
      }

      if (attempts === 0) {
        params.onStatus?.("Finding important passages…");
      }
      await sleep(800);
    }

    throw new Error("Codex highlight run timed out.");
  } finally {
    if (completed) {
      await cleanupWorkspaceIfEnabled(started.workspacePath);
    }
  }
}

async function resolveOpenPDFAttachment(itemID: number) {
  const reader = await getActiveReader();
  const readerAttachmentID = reader?.itemID;
  const selected = await Zotero.Items.getAsync(readerAttachmentID || itemID);

  if (selected?.isPDFAttachment?.()) {
    return { attachment: selected as Zotero.Item, reader };
  }

  const item = selected as Zotero.Item;
  const attachmentID = item?.isAttachment?.()
    ? item.id
    : item?.getAttachments?.().find((candidateID) => {
        const attachment = Zotero.Items.get(candidateID);
        return attachment?.isPDFAttachment?.();
      });

  const attachment = attachmentID ? Zotero.Items.get(attachmentID) : undefined;
  if (!attachment?.isPDFAttachment?.()) {
    throw new Error("Open reader item is not a PDF attachment.");
  }

  return { attachment, reader };
}

export async function runAutoHighlightWorkflow(params: {
  itemID: number;
  itemTitle: string;
  onStatus?: (status: string) => void;
}): Promise<{ result: AutoHighlightResult; summary: string }> {
  const { attachment, reader } = await resolveOpenPDFAttachment(params.itemID);

  const rawResponse = await waitForCodexText({
    itemID: attachment.id,
    title: params.itemTitle,
    question: buildAutoHighlightQuestion(DEFAULT_AUTO_HIGHLIGHT_LIMIT),
    onStatus: params.onStatus,
  });
  const candidates = await parseHighlightCandidatesWithRepair({
    itemID: attachment.id,
    title: params.itemTitle,
    rawResponse,
    onStatus: params.onStatus,
    requestText: waitForCodexText,
  });

  params.onStatus?.("Matching quotes to PDF…");
  const filePath = await attachment.getFilePathAsync();
  if (!filePath) {
    throw new Error("Could not locate the current PDF file on disk.");
  }

  const pages =
    reader?.type === "pdf"
      ? await extractPdfTextPagesFromReader(
          reader as Parameters<typeof extractPdfTextPagesFromReader>[0],
        )
      : await extractPdfTextPages(filePath);
  if (!pages.length) {
    throw new Error("Could not extract readable PDF text geometry.");
  }

  const existingAnnotations = attachment.getAnnotations();
  const createdItems: Zotero.Item[] = [];
  let skipped = 0;
  let unmatched = 0;

  for (const candidate of candidates) {
    const match = matchQuoteInPages(candidate.quote, pages);
    if (!match) {
      unmatched += 1;
      continue;
    }

    if (isDuplicateHighlight(existingAnnotations, match)) {
      skipped += 1;
      continue;
    }

    const payload = buildHighlightAnnotationJSON(match);
    const saved = await Zotero.Annotations.saveFromJSON(
      attachment,
      payload as unknown as Parameters<
        typeof Zotero.Annotations.saveFromJSON
      >[1],
    );
    existingAnnotations.push(saved);
    createdItems.push(saved);
  }

  if (
    createdItems.length &&
    reader?.itemID === attachment.id &&
    reader.setAnnotations
  ) {
    await reader.setAnnotations(createdItems);
  }

  const result: AutoHighlightResult = {
    created: createdItems.length,
    skipped,
    unmatched,
    totalCandidates: candidates.length,
  };
  const summary = formatAutoHighlightSummary(result);

  if (!result.created && !result.skipped) {
    throw new Error(summary);
  }

  return { result, summary };
}
