import { getPref } from "../../utils/prefs";
import { normalizeResponseLanguage } from "../translation/responseLanguage";
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
import { getCurrentReaderContext } from "../context/readerContext";
import { getIndexedChunks } from "../context/indexStore";
import { findNearbyContext } from "../context/nearbyContext";
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
  writeWorkspaceSupplementalFiles,
  type WorkspaceSupplementalFiles,
} from "../workspace/supplementalFiles";
import {
  buildCodexExecCommand,
  buildCodexResumeCommand,
} from "./commandBuilder";
import { buildCodexCommandEnvironment } from "./environment";
import { resolveCodexExecutablePath } from "./executable";
import {
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
} from "./modelOptions";
import { parseCodexOutput } from "./outputParser";
import { buildBackgroundCodexShellScript } from "./shell";

declare const Zotero: any;

export interface StartedCodexRun {
  ok: true;
  workspacePath: string;
  promptPreview: string;
  outputPath: string;
  stderrPath: string;
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
  webSearchEnabledOverride?: boolean;
  profile?: RunProfile;
  outputSchema?: StructuredOutputSchema;
  workspaceFiles?: WorkspaceSupplementalFiles;
}): Promise<StartedCodexRun | FailedCodexRun> {
  const profile = params.profile || "chat";
  const executablePath = await resolveCodexExecutablePath(
    String(getPref("codexExecutablePath") || ""),
  );
  const model = normalizeCodexModel(
    String(getPref("codexDefaultModel") || "gpt-5.6-sol"),
  );
  const reasoningEffort = normalizeCodexReasoningEffort(
    String(getPref("codexReasoningEffort") || "medium"),
    model,
  );
  const workspaceRoot = String(
    getPref("codexWorkspaceRoot") || "/tmp/zotero-paper-ai",
  );
  const webSearchEnabled =
    profile === "analysis"
      ? false
      : profile === "discovery"
        ? true
        : (params.webSearchEnabledOverride ??
          Boolean(getPref("codexEnableWebSearch")));
  const sandbox = (
    profile === "chat"
      ? String(getPref("codexSandboxMode") || "read-only")
      : "read-only"
  ) as "read-only" | "workspace-write" | "danger-full-access";
  const approvalMode = String(getPref("codexApprovalMode") || "never");
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
    ? findNearbyContext({ fullText, selectedText: params.selectedText })
    : undefined;
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
    requestText: params.question,
  });

  const promptPath = `${workspacePath}/prompt.txt`;
  const outputPath = `${workspacePath}/codex-output.jsonl`;
  const stderrPath = `${workspacePath}/codex-stderr.log`;
  const exitCodePath = `${workspacePath}/codex-exit.txt`;
  const pidPath = `${workspacePath}/codex-pid.txt`;
  const outputSchemaPath = `${workspacePath}/output-schema.json`;
  const paperPath = `${workspacePath}/paper.txt`;
  const paperMarkdownPath = `${workspacePath}/paper.md`;
  const paperJsonPath = `${workspacePath}/paper.json`;
  const contextIndexPath = `${workspacePath}/CONTEXT_INDEX.md`;
  const metadataPath = `${workspacePath}/metadata.json`;
  const annotationsPath = `${workspacePath}/annotations.json`;
  const selectionPath = `${workspacePath}/selection.json`;
  const recentTurnsPath = `${workspacePath}/recent-turns.json`;
  const figuresDir = `${workspacePath}/figures`;
  const discoveryRequestPath = `${workspacePath}/discovery-request.json`;
  const discoveryPlanPath = `${workspacePath}/discovery-plan.json`;
  const discoveryCandidatesPath = `${workspacePath}/discovery-candidates.json`;
  const discoveryEvidencePath = `${workspacePath}/discovery-evidence.json`;
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
      helpArgs: ["exec", "--help"],
      flag: "--output-schema",
      environment: buildCodexCommandEnvironment(executablePath),
    }))
      ? compatibleOutputSchema
      : undefined;
  if (nativeOutputSchema) {
    await Zotero.File.putContentsAsync(
      outputSchemaPath,
      JSON.stringify(nativeOutputSchema, null, 2),
      "utf-8",
    );
  }

  const command =
    params.useResume && canResumeProviderSession(profile)
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
            outputSchemaPath: nativeOutputSchema ? outputSchemaPath : undefined,
            skipGitRepoCheck: true,
          },
          executablePath,
        );

  const script = buildBackgroundCodexShellScript({
    promptPath,
    outputPath,
    stderrPath,
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
    stderrPath,
    exitCodePath,
    pidPath,
    processId,
  } satisfies StartedCodexRun;
}

export async function readCodexRunProgress(paths: {
  outputPath: string;
  stderrPath: string;
  exitCodePath: string;
}) {
  const stdout = await readTextFile(paths.outputPath);
  const stderr = await readTextFile(paths.stderrPath);
  const rawOutput = [stdout, stderr].filter(Boolean).join("\n");
  const parsed = parseCodexOutput(stdout);
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
