import { getPref } from "../../utils/prefs";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import { getCurrentReaderContext } from "../context/readerContext";
import { getIndexedChunks } from "../context/indexStore";
import {
  buildCodexWorkspacePrompt,
  buildContextPayload,
} from "../context/promptPreviewBuilder";
import { selectRelevantChunksFromChunks } from "../context/retriever";
import { buildWorkspaceArtifacts } from "../context/workspaceArtifacts";
import { messageStore } from "../message/messageStore";
import {
  paperWorkspaceContentCache,
  type PaperWorkspaceContent,
} from "../tools/paperWorkspaceContent";
import { buildPaperWorkspacePath } from "../workspace/pathBuilder";
import {
  buildCodexExecCommand,
  buildCodexResumeCommand,
} from "./commandBuilder";
import { buildCodexCommandEnvironment } from "./environment";
import { resolveCodexExecutablePath } from "./executable";
import { parseCodexOutput } from "./outputParser";
import { buildBackgroundCodexShellScript } from "./shell";

export interface StartedCodexRun {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  exitCodePath: string;
  pidPath: string;
  processId?: string;
}

interface FailedCodexRun {
  ok: false;
  workspacePath: string;
  promptPreview: string;
  error: string;
}

async function readTextFile(path: string) {
  try {
    const contents = await Promise.resolve(
      Zotero.File.getContentsAsync(path, "utf-8"),
    );
    return String(contents || "");
  } catch {
    return "";
  }
}

export async function startCodexRunForQuestion(params: {
  itemID: number;
  title: string;
  sessionId: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  useResume: boolean;
  resumeSessionId?: string;
  imagePath?: string;
}): Promise<StartedCodexRun | FailedCodexRun> {
  const executablePath = await resolveCodexExecutablePath(
    String(getPref("codexExecutablePath") || ""),
  );
  const model = String(getPref("codexDefaultModel") || "gpt-5-codex");
  const reasoningEffort = String(getPref("codexReasoningEffort") || "").trim();
  const workspaceRoot = String(
    getPref("codexWorkspaceRoot") || "/tmp/zotero-paper-ai",
  );
  const webSearchEnabled = Boolean(getPref("codexEnableWebSearch"));
  const sandbox = String(getPref("codexSandboxMode") || "read-only") as
    | "read-only"
    | "workspace-write"
    | "danger-full-access";
  const approvalMode = String(getPref("codexApprovalMode") || "never");
  const workspacePath = buildPaperWorkspacePath({
    root: workspaceRoot,
    itemID: params.itemID,
    title: params.title,
  });

  await Zotero.File.createDirectoryIfMissingAsync(workspacePath);

  const payload = buildContextPayload({
    question: params.question,
    responseLanguage: normalizeResponseLanguage(getPref("responseLanguage")),
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    surroundingText: getPref("retrievalIncludeNearbyContext")
      ? params.selectedText
      : undefined,
    recentTurns: messageStore.recentRaw(params.sessionId, 3).map((message) => ({
      role: message.role,
      text: message.text,
    })),
  });
  const readerContext = await getCurrentReaderContext();
  payload.pageNumber = readerContext.pageIndex;

  const item = (await Zotero.Items.getAsync(params.itemID)) as Zotero.Item;
  const authors =
    typeof item.getCreators === "function"
      ? item
          .getCreators()
          .map((creator) =>
            [creator.firstName, creator.lastName]
              .filter(Boolean)
              .join(" ")
              .trim(),
          )
          .filter(Boolean)
      : [];
  const attachmentID = !item.isAttachment()
    ? item.getAttachments().find((id) => {
        const attachment = Zotero.Items.get(id);
        return (
          attachment.attachmentContentType === "application/pdf" ||
          attachment.attachmentContentType === ""
        );
      })
    : item.id;
  const attachment = attachmentID ? Zotero.Items.get(attachmentID) : undefined;
  const paperContent: PaperWorkspaceContent = await paperWorkspaceContentCache
    .getPaperContent(item)
    .catch(() => ({
      fullText: "",
      markdownText: "",
      structuredContent: undefined,
      extractionMethod: "zotero-attachment-text" as const,
      extractionNotes: [
        "Paper extraction failed; workspace paper files are empty.",
      ],
    }));
  const fullText = paperContent.fullText;
  const indexedChunks = getIndexedChunks({
    itemKey: String(item.key || params.itemID),
    text: fullText,
    chunkSize: Number(getPref("retrievalChunkSize") || 1100),
    overlapSize: Number(getPref("retrievalOverlapSize") || 200),
  });
  const retrievedChunks = selectRelevantChunksFromChunks(
    indexedChunks,
    [params.question, params.selectedText].filter(Boolean).join("\n"),
    Number(getPref("retrievalTopK") || 5),
  );
  payload.retrievedChunks = retrievedChunks;

  const artifacts = buildWorkspaceArtifacts({
    title: params.title,
    authors,
    year: String(item.getField("year") || ""),
    itemKey: String(item.key || ""),
    attachmentKey: String(attachment?.key || ""),
    abstractNote: getPref("retrievalIncludeAbstract")
      ? String(item.getField("abstractNote") || "")
      : "",
    fullText: String(fullText || ""),
    markdownText: paperContent.markdownText,
    structuredContent: paperContent.structuredContent,
    extractionMethod: paperContent.extractionMethod,
    extractionNotes: paperContent.extractionNotes,
    payload,
    annotations: params.annotationIDs ?? [],
    recentTurns: messageStore.recentRaw(params.sessionId, 3).map((message) => ({
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    })),
  });

  const promptPath = `${workspacePath}/prompt.txt`;
  const outputPath = `${workspacePath}/codex-output.jsonl`;
  const exitCodePath = `${workspacePath}/codex-exit.txt`;
  const pidPath = `${workspacePath}/codex-pid.txt`;
  const paperPath = `${workspacePath}/paper.txt`;
  const paperMarkdownPath = `${workspacePath}/paper.md`;
  const paperJsonPath = `${workspacePath}/paper.json`;
  const contextIndexPath = `${workspacePath}/CONTEXT_INDEX.md`;
  const metadataPath = `${workspacePath}/metadata.json`;
  const annotationsPath = `${workspacePath}/annotations.json`;
  const selectionPath = `${workspacePath}/selection.json`;
  const recentTurnsPath = `${workspacePath}/recent-turns.json`;
  const figuresDir = `${workspacePath}/figures`;
  const codexPrompt = buildCodexWorkspacePrompt(
    payload.promptPreview,
    webSearchEnabled,
  );
  await Zotero.File.putContentsAsync(promptPath, codexPrompt, "utf-8");
  await Zotero.File.createDirectoryIfMissingAsync(figuresDir);
  await Zotero.File.putContentsAsync(
    contextIndexPath,
    artifacts.contextIndexText,
    "utf-8",
  );
  await Zotero.File.putContentsAsync(paperPath, artifacts.paperText, "utf-8");
  await Zotero.File.putContentsAsync(
    paperMarkdownPath,
    artifacts.paperMarkdownText,
    "utf-8",
  );
  await Zotero.File.putContentsAsync(
    paperJsonPath,
    JSON.stringify(artifacts.paperJson, null, 2),
    "utf-8",
  );
  await Zotero.File.putContentsAsync(
    metadataPath,
    JSON.stringify(artifacts.metadata, null, 2),
    "utf-8",
  );
  await Zotero.File.putContentsAsync(
    annotationsPath,
    JSON.stringify(artifacts.annotations, null, 2),
    "utf-8",
  );
  await Zotero.File.putContentsAsync(
    selectionPath,
    JSON.stringify(artifacts.selection, null, 2),
    "utf-8",
  );
  await Zotero.File.putContentsAsync(
    recentTurnsPath,
    JSON.stringify(artifacts.recentTurns, null, 2),
    "utf-8",
  );

  const command = params.useResume
    ? buildCodexResumeCommand(
        {
          cd: workspacePath,
          sessionId: params.resumeSessionId,
          model,
          reasoningEffort,
          webSearchEnabled,
        },
        executablePath,
      )
    : buildCodexExecCommand(
        {
          cd: workspacePath,
          model,
          reasoningEffort,
          sandbox,
          approvalMode,
          webSearchEnabled,
          imagePath: params.imagePath,
          skipGitRepoCheck: true,
        },
        executablePath,
      );

  const script = buildBackgroundCodexShellScript({
    promptPath,
    outputPath,
    exitCodePath,
    pidPath,
    command,
    environment: buildCodexCommandEnvironment(executablePath),
  });

  const result = await Zotero.Utilities.Internal.exec("/bin/zsh", [
    "-lc",
    script,
  ]);
  if (result instanceof Error) {
    return {
      ok: false as const,
      workspacePath,
      promptPreview: codexPrompt,
      error: result.message,
    };
  }

  const processId = (await readTextFile(pidPath)).trim();

  return {
    ok: true,
    workspacePath,
    promptPreview: codexPrompt,
    outputPath,
    exitCodePath,
    pidPath,
    processId,
  } satisfies StartedCodexRun;
}

export async function readCodexRunProgress(paths: {
  outputPath: string;
  exitCodePath: string;
}) {
  const rawOutput = await readTextFile(paths.outputPath);
  const parsed = parseCodexOutput(rawOutput);
  const exitCode = (await readTextFile(paths.exitCodePath)).trim();

  return {
    rawOutput,
    parsedOutput: parsed.text,
    structuredOutput: parsed.structuredOutput,
    latestEventType: parsed.latestEventType,
    completed: exitCode.length > 0,
    exitCode,
  };
}
