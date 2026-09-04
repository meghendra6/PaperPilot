import { getPref } from "../../utils/prefs";
import { buildCliCommandEnvironment } from "../ai/cliEnvironment";
import {
  launchDetachedShellScript,
  type ShellExecutor,
} from "../ai/launchScript";
import { normalizeGeminiModel } from "../codex/modelOptions";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
import {
  canResumeProviderSession,
  getRunWorkspaceTitle,
  type RunProfile,
} from "../ai/runProfile";
import {
  cliSupportsFlag,
  type StructuredOutputSchema,
} from "../ai/structuredOutput";
import { getCurrentReaderContext } from "../context/readerContext";
import { getIndexedChunks } from "../context/indexStore";
import { findNearbyContext } from "../context/nearbyContext";
import {
  buildContextPayload,
  buildGeminiWorkspacePrompt,
} from "../context/promptPreviewBuilder";
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
import { shellEscape } from "../codex/shell";
import { readOptionalRunTextFile } from "../ai/runFileReader";

declare const Zotero: any;

export interface StartedGeminiRun {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  processId?: string;
}

interface FailedGeminiRun {
  ok: false;
  workspacePath: string;
  promptPreview: string;
  error: string;
}

export function launchGeminiRunScript(
  script: string,
  execute: ShellExecutor = (executable, args) =>
    Zotero.Utilities.Internal.exec(executable, args),
) {
  return launchDetachedShellScript(script, execute);
}

export type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan";

const GEMINI_APPROVAL_MODES = new Set<GeminiApprovalMode>([
  "default",
  "auto_edit",
  "yolo",
  "plan",
]);

export function normalizeGeminiApprovalMode(
  approvalMode: string,
): GeminiApprovalMode {
  const normalized = approvalMode.trim() as GeminiApprovalMode;
  return GEMINI_APPROVAL_MODES.has(normalized) ? normalized : "default";
}

export function buildGeminiCommand(params: {
  promptPath: string;
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
  pidPath: string;
  workspacePath: string;
  question: string;
  model: string;
  resumeSessionId?: string;
  executablePath: string;
  profile: RunProfile;
  approvalMode: string;
  sandboxSupported?: boolean;
}) {
  const env = buildCliCommandEnvironment(params.executablePath);
  const environmentLines = Object.entries(env)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `export ${key}=${shellEscape(String(value))}`);

  const outputDir = params.outputPath.replace(/\/[^/]+$/, "");
  const resumePart = params.resumeSessionId
    ? `--resume ${shellEscape(params.resumeSessionId)}`
    : "";
  const approvalMode =
    params.profile === "chat"
      ? normalizeGeminiApprovalMode(params.approvalMode)
      : "plan";
  const sandboxPart = params.sandboxSupported ? "--sandbox" : "";

  return [
    `mkdir -p ${shellEscape(outputDir)}`,
    `rm -f ${shellEscape(params.outputPath)} ${shellEscape(params.stderrPath)} ${shellEscape(params.exitCodePath)} ${shellEscape(params.pidPath)}`,
    ...environmentLines,
    `(` +
      `cd ${shellEscape(params.workspacePath)} && ` +
      `cat ${shellEscape(params.promptPath)} | ${shellEscape(params.executablePath)} --skip-trust ${resumePart} -m ${shellEscape(params.model)} --approval-mode ${shellEscape(approvalMode)} ${sandboxPart} --output-format text -p '' > ${shellEscape(params.outputPath)} 2> ${shellEscape(params.stderrPath)}; ` +
      `printf '%s' $? > ${shellEscape(params.exitCodePath)}` +
      `) & echo $! > ${shellEscape(params.pidPath)}`,
  ].join(" && ");
}

export async function startGeminiRunForQuestion(params: {
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
}): Promise<StartedGeminiRun | FailedGeminiRun> {
  const profile = params.profile || "chat";
  const executablePath =
    String(getPref("geminiExecutablePath") || "gemini").trim() || "gemini";
  const preferredModel = String(
    getPref("geminiDefaultModel") || "gemini-3.1-pro-preview",
  ).trim();
  const model = normalizeGeminiModel(preferredModel);
  const approvalMode = normalizeGeminiApprovalMode(
    String(getPref("geminiApprovalMode") || "default"),
  );

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
    responseLanguage: normalizeResponseLanguage(getPref("responseLanguage")),
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

  const promptPath = `${workspacePath}/gemini-prompt.txt`;
  const outputPath = `${workspacePath}/gemini-output.txt`;
  const stderrPath = `${workspacePath}/gemini-stderr.log`;
  const exitCodePath = `${workspacePath}/gemini-exit.txt`;
  const pidPath = `${workspacePath}/gemini-pid.txt`;
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

  const geminiPrompt = buildGeminiWorkspacePrompt(payload.promptPreview);
  await Zotero.File.putContentsAsync(promptPath, geminiPrompt, "utf-8");
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

  const environment = buildCliCommandEnvironment(executablePath);
  const sandboxSupported = await cliSupportsFlag({
    executablePath,
    helpArgs: ["--help"],
    flag: "--sandbox",
    environment,
  });
  const script = buildGeminiCommand({
    promptPath,
    outputPath,
    stderrPath,
    exitCodePath,
    pidPath,
    workspacePath,
    question: params.question,
    model,
    resumeSessionId: canResumeProviderSession(profile)
      ? params.resumeSessionId
      : undefined,
    executablePath,
    profile,
    approvalMode,
    sandboxSupported,
  });

  const result = await launchGeminiRunScript(script);
  if (!result.ok) {
    return {
      ok: false,
      workspacePath,
      promptPreview: geminiPrompt,
      error: result.error,
    };
  }

  const processId = (await readOptionalRunTextFile(pidPath))?.trim();
  return {
    ok: true,
    workspacePath,
    promptPreview: geminiPrompt,
    outputPath,
    stderrPath,
    exitCodePath,
    pidPath,
    processId,
  };
}

export async function readGeminiRunProgress(paths: {
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
