import { getPref } from "../../utils/prefs";
import { buildCliCommandEnvironment } from "../ai/cliEnvironment";
import {
  executionSettingsForMode,
  type ExecutionSettings,
} from "../ai/executionSettings";
import {
  launchDetachedShellScript,
  type ShellExecutor,
} from "../ai/launchScript";
import { readOptionalRunTextFile } from "../ai/runFileReader";
import {
  canResumeProviderSession,
  getRunWorkspaceTitle,
  type RunProfile,
} from "../ai/runProfile";
import {
  cliSupportsFlag,
  compatibleNativeOutputSchema,
  type StructuredOutputSchema,
} from "../ai/structuredOutput";
import { shellEscape } from "../codex/shell";
import { getIndexedChunks } from "../context/indexStore";
import { findNearbyContext } from "../context/nearbyContext";
import {
  buildClaudeWorkspacePrompt,
  buildContextPayload,
} from "../context/promptPreviewBuilder";
import { getCurrentReaderContext } from "../context/readerContext";
import { selectRelevantChunksFromChunks } from "../context/retriever";
import { buildWorkspaceArtifacts } from "../context/workspaceArtifacts";
import { messageStore } from "../message/messageStore";
import {
  paperWorkspaceContentCache,
  type PaperWorkspaceContent,
} from "../tools/paperWorkspaceContent";
import {
  buildPaperWorkspacePath,
  resolvePaperWorkspaceRoot,
} from "../workspace/pathBuilder";
import {
  writeWorkspaceSupplementalFiles,
  type WorkspaceSupplementalFiles,
} from "../workspace/supplementalFiles";

declare const Zotero: any;

export interface StartedClaudeRun {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  stderrPath: string;
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

export function launchClaudeRunScript(
  script: string,
  execute: ShellExecutor = (executable, args) =>
    Zotero.Utilities.Internal.exec(executable, args),
) {
  return launchDetachedShellScript(script, execute);
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

export function buildClaudeCommand(params: {
  promptPath: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  workspacePath: string;
  model: string;
  resumeSessionId?: string;
  executablePath: string;
  permissionMode: string;
  outputSchema?: StructuredOutputSchema;
}) {
  const env = buildCliCommandEnvironment(params.executablePath);
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
  const outputSchemaPart = params.outputSchema
    ? `--json-schema ${shellEscape(JSON.stringify(params.outputSchema))}`
    : "";

  return [
    `mkdir -p ${shellEscape(outputDir)}`,
    `rm -f ${shellEscape(params.outputPath)} ${shellEscape(params.stderrPath)} ${shellEscape(params.exitCodePath)} ${shellEscape(params.pidPath)}`,
    ...environmentLines,
    `(` +
      `cd ${shellEscape(params.workspacePath)} && ` +
      `cat ${shellEscape(params.promptPath)} | ${shellEscape(params.executablePath)} -p --output-format text --model ${shellEscape(params.model)} ${resumePart} ${outputSchemaPart} --permission-mode ${shellEscape(permissionMode)} --setting-sources project,local > ${shellEscape(params.outputPath)} 2> ${shellEscape(params.stderrPath)}; ` +
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
  profile?: RunProfile;
  outputSchema?: StructuredOutputSchema;
  workspaceFiles?: WorkspaceSupplementalFiles;
  executionSettings?: ExecutionSettings;
}): Promise<StartedClaudeRun | FailedClaudeRun> {
  const settings = executionSettingsForMode(
    "claude_code",
    params.executionSettings,
  );
  const profile = params.profile || "chat";
  const executablePath =
    String(getPref("claudeExecutablePath") || "claude").trim() || "claude";
  const { model } = settings;
  const permissionMode =
    profile === "chat"
      ? String(getPref("claudePermissionMode") || "default").trim()
      : "plan";

  const workspaceRoot = resolvePaperWorkspaceRoot(
    getPref("codexWorkspaceRoot"),
  );
  const workspacePath = buildPaperWorkspacePath({
    root: workspaceRoot,
    itemID: params.itemID,
    title: getRunWorkspaceTitle(params.title, profile),
  });

  await Zotero.File.createDirectoryIfMissingAsync(workspacePath);

  const payload = buildContextPayload({
    question: params.question,
    responseLanguage: settings.responseLanguage,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
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
  payload.surroundingText = getPref("retrievalIncludeNearbyContext")
    ? findNearbyContext({
        fullText,
        selectedText: params.selectedText,
        pageIndex: readerContext.pageIndex,
      })
    : undefined;
  const indexedChunks = getIndexedChunks({
    libraryID: item.libraryID,
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
    recentTurns: messageStore
      .recentForWorkspace(params.sessionId, 3)
      .map((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      })),
    requestText: params.question,
  });

  const promptPath = `${workspacePath}/claude-prompt.txt`;
  const outputPath = `${workspacePath}/claude-output.txt`;
  const stderrPath = `${workspacePath}/claude-stderr.log`;
  const exitCodePath = `${workspacePath}/claude-exit.txt`;
  const pidPath = `${workspacePath}/claude-pid.txt`;
  const paperPath = `${workspacePath}/paper.txt`;
  const paperMarkdownPath = `${workspacePath}/paper.md`;
  const paperJsonPath = `${workspacePath}/paper.json`;
  const metadataPath = `${workspacePath}/metadata.json`;
  const annotationsPath = `${workspacePath}/annotations.json`;
  const selectionPath = `${workspacePath}/selection.json`;
  const recentTurnsPath = `${workspacePath}/recent-turns.json`;
  const contextIndexPath = `${workspacePath}/CONTEXT_INDEX.md`;
  const discoveryRequestPath = `${workspacePath}/discovery-request.json`;
  const discoveryPlanPath = `${workspacePath}/discovery-plan.json`;
  const discoveryCandidatesPath = `${workspacePath}/discovery-candidates.json`;
  const discoveryEvidencePath = `${workspacePath}/discovery-evidence.json`;

  const claudePrompt = buildClaudeWorkspacePrompt(payload.promptPreview);
  await Zotero.File.putContentsAsync(promptPath, claudePrompt, "utf-8");
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
  await writeWorkspaceSupplementalFiles(workspacePath, params.workspaceFiles);
  if (artifacts.discoveryArtifacts) {
    await Zotero.File.putContentsAsync(
      discoveryRequestPath,
      JSON.stringify(artifacts.discoveryArtifacts.request, null, 2),
      "utf-8",
    );
    await Zotero.File.putContentsAsync(
      discoveryPlanPath,
      JSON.stringify(artifacts.discoveryArtifacts.plan, null, 2),
      "utf-8",
    );
    await Zotero.File.putContentsAsync(
      discoveryCandidatesPath,
      JSON.stringify(artifacts.discoveryArtifacts.candidates, null, 2),
      "utf-8",
    );
    await Zotero.File.putContentsAsync(
      discoveryEvidencePath,
      JSON.stringify(artifacts.discoveryArtifacts.evidence, null, 2),
      "utf-8",
    );
  }

  const compatibleOutputSchema = compatibleNativeOutputSchema(
    params.outputSchema,
  );
  const nativeOutputSchema =
    compatibleOutputSchema &&
    (await cliSupportsFlag({
      executablePath,
      helpArgs: ["--help"],
      flag: "--json-schema",
      environment: buildCliCommandEnvironment(executablePath),
    }))
      ? compatibleOutputSchema
      : undefined;

  const script = buildClaudeCommand({
    promptPath,
    outputPath,
    stderrPath,
    exitCodePath,
    pidPath,
    workspacePath,
    model,
    resumeSessionId: canResumeProviderSession(profile)
      ? params.resumeSessionId
      : undefined,
    executablePath,
    permissionMode,
    outputSchema: nativeOutputSchema,
  });

  const result = await launchClaudeRunScript(script);
  if (!result.ok) {
    return {
      ok: false,
      workspacePath,
      promptPreview: claudePrompt,
      error: result.error,
    };
  }

  const processId = (await readOptionalRunTextFile(pidPath))?.trim();
  return {
    ok: true,
    workspacePath,
    promptPreview: claudePrompt,
    outputPath,
    stderrPath,
    exitCodePath,
    pidPath,
    processId,
  };
}

export async function readClaudeRunProgress(paths: {
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
}) {
  const stdout = (await readOptionalRunTextFile(paths.outputPath)) ?? "";
  const stderr = (await readOptionalRunTextFile(paths.stderrPath)) ?? "";
  const rawOutput = [stdout, stderr].filter(Boolean).join("\n");
  const exitCodeText = await readOptionalRunTextFile(paths.exitCodePath);
  const exitCode = exitCodeText?.trim() ?? "file-read-error";

  return {
    rawOutput,
    diagnosticOutput:
      exitCodeText === undefined
        ? [stderr, "The run exit-code file could not be read."]
            .filter(Boolean)
            .join("\n")
        : stderr,
    parsedOutput: stdout.trim(),
    structuredOutput: false,
    latestEventType: stdout ? "text" : stderr ? "diagnostic" : "unknown",
    completed: exitCodeText === undefined || exitCode.length > 0,
    exitCode,
  };
}
