import { getPref, setPref } from "../../utils/prefs";
import { normalizeClaudeModel } from "../codex/modelOptions";
import { shellEscape } from "../codex/shell";
import {
  buildClaudeWorkspacePrompt,
  buildContextPayload,
} from "../context/promptPreviewBuilder";
import { getCurrentReaderContext } from "../context/readerContext";
import { getIndexedChunks } from "../context/indexStore";
import { selectRelevantChunksFromChunks } from "../context/retriever";
import { messageStore } from "../message/messageStore";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import {
  paperWorkspaceContentCache,
  type PaperWorkspaceContent,
} from "../tools/paperWorkspaceContent";
import { buildPaperWorkspacePath } from "../workspace/pathBuilder";
import { buildWorkspaceArtifacts } from "../context/workspaceArtifacts";

declare const Zotero: any;

export interface StartedClaudeRun {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  exitCodePath: string;
  pidPath: string;
  processId?: string;
}

interface FailedClaudeRun {
  ok: false;
  workspacePath: string;
  promptPreview: string;
  error: string;
}

function buildClaudeShellEnvironment() {
  const profilePath =
    (globalThis as { Zotero?: any }).Zotero?.getProfileDirectory?.()?.path ||
    "";
  const userHome = profilePath.includes("/Library/")
    ? profilePath.split("/Library/")[0]
    : "";

  return {
    HOME: userHome || undefined,
    XDG_CONFIG_HOME: userHome ? `${userHome}/.config` : undefined,
    PATH: [
      "/opt/homebrew/bin",
      `${userHome}/.local/bin`,
      `${userHome}/bin`,
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]
      .filter(Boolean)
      .join(":"),
  };
}

function normalizeClaudePermissionMode(permissionMode: string) {
  const normalized = permissionMode.trim();
  return [
    "default",
    "acceptEdits",
    "auto",
    "bypassPermissions",
    "dontAsk",
    "plan",
  ].includes(normalized)
    ? normalized
    : "default";
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

export function buildClaudeCommand(params: {
  promptPath: string;
  outputPath: string;
  exitCodePath: string;
  pidPath: string;
  workspacePath: string;
  model: string;
  resumeSessionId?: string;
  executablePath: string;
  permissionMode: string;
}) {
  const env = buildClaudeShellEnvironment();
  const environmentLines = Object.entries(env)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `export ${key}=${shellEscape(String(value))}`);

  const outputDir = params.outputPath.replace(/\/[^/]+$/, "");
  const resumePart = params.resumeSessionId
    ? params.resumeSessionId === "latest"
      ? "--continue"
      : `--resume ${shellEscape(params.resumeSessionId)}`
    : "";
  const permissionMode = normalizeClaudePermissionMode(params.permissionMode);

  return [
    `mkdir -p ${shellEscape(outputDir)}`,
    `rm -f ${shellEscape(params.outputPath)} ${shellEscape(params.exitCodePath)} ${shellEscape(params.pidPath)}`,
    ...environmentLines,
    `(` +
      `cd ${shellEscape(params.workspacePath)} && ` +
      `cat ${shellEscape(params.promptPath)} | ${shellEscape(params.executablePath)} -p --output-format text --model ${shellEscape(params.model)} ${resumePart} --permission-mode ${shellEscape(permissionMode)} > ${shellEscape(params.outputPath)} 2>&1; ` +
      `printf '%s' $? > ${shellEscape(params.exitCodePath)}` +
      `) & echo $! > ${shellEscape(params.pidPath)}`,
  ].join(" && ");
}

export async function startClaudeRunForQuestion(params: {
  itemID: number;
  title: string;
  sessionId: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  resumeSessionId?: string;
}): Promise<StartedClaudeRun | FailedClaudeRun> {
  const executablePath =
    String(getPref("claudeExecutablePath") || "claude").trim() || "claude";
  const preferredModel = String(
    getPref("claudeDefaultModel") || "sonnet",
  ).trim();
  const model = normalizeClaudeModel(preferredModel);
  const permissionMode = String(
    getPref("claudePermissionMode") || "default",
  ).trim();

  if (model !== preferredModel) {
    setPref("claudeDefaultModel", model);
  }

  const workspaceRoot = String(
    getPref("codexWorkspaceRoot") || "/tmp/zotero-paper-ai",
  );
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

  const item = (await Zotero.Items.getAsync(params.itemID)) as any;
  const authors =
    typeof item.getCreators === "function"
      ? item
          .getCreators()
          .map((creator: { firstName?: string; lastName?: string }) =>
            [creator.firstName, creator.lastName]
              .filter(Boolean)
              .join(" ")
              .trim(),
          )
          .filter(Boolean)
      : [];
  const attachmentID = !item.isAttachment()
    ? item.getAttachments().find((id: number) => {
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

  const promptPath = `${workspacePath}/claude-prompt.txt`;
  const outputPath = `${workspacePath}/claude-output.txt`;
  const exitCodePath = `${workspacePath}/claude-exit.txt`;
  const pidPath = `${workspacePath}/claude-pid.txt`;
  const paperPath = `${workspacePath}/paper.txt`;
  const paperMarkdownPath = `${workspacePath}/paper.md`;
  const paperJsonPath = `${workspacePath}/paper.json`;
  const metadataPath = `${workspacePath}/metadata.json`;
  const annotationsPath = `${workspacePath}/annotations.json`;
  const selectionPath = `${workspacePath}/selection.json`;
  const recentTurnsPath = `${workspacePath}/recent-turns.json`;

  const claudePrompt = buildClaudeWorkspacePrompt(payload.promptPreview);
  await Zotero.File.putContentsAsync(promptPath, claudePrompt, "utf-8");
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

  const script = buildClaudeCommand({
    promptPath,
    outputPath,
    exitCodePath,
    pidPath,
    workspacePath,
    model,
    resumeSessionId: params.resumeSessionId,
    executablePath,
    permissionMode,
  });

  const result = await Zotero.Utilities.Internal.exec("/bin/zsh", [
    "-lc",
    script,
  ]);
  if (result instanceof Error) {
    return {
      ok: false,
      workspacePath,
      promptPreview: claudePrompt,
      error: result.message,
    };
  }

  const processId = (await readTextFile(pidPath)).trim();
  return {
    ok: true,
    workspacePath,
    promptPreview: claudePrompt,
    outputPath,
    exitCodePath,
    pidPath,
    processId,
  };
}

export async function readClaudeRunProgress(paths: {
  outputPath: string;
  exitCodePath: string;
}) {
  const rawOutput = await readTextFile(paths.outputPath);
  const exitCode = (await readTextFile(paths.exitCodePath)).trim();

  return {
    rawOutput,
    parsedOutput: rawOutput.trim(),
    structuredOutput: false,
    latestEventType: rawOutput ? "text" : "unknown",
    completed: exitCode.length > 0,
    exitCode,
  };
}
