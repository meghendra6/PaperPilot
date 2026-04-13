import { addMessage, setMessageContent } from "../components/ChatMessage";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionHistoryService } from "../session/sessionHistoryService";
import { startGeminiRunForQuestion, readGeminiRunProgress } from "./runner";

export async function handleGeminiQuestion(params: {
  itemID: number;
  sessionId: string;
  sessionTitle: string;
  paperTitle?: string;
  question: string;
  selectedText?: string;
  annotationIDs?: string[];
  resumeSessionId?: string;
  chatMessages: HTMLElement;
  streamingIndicator: HTMLElement;
  suppressChatMessages?: boolean;
  onComplete?: (result: { success: boolean; assistantText: string }) => void;
}) {
  const result = await startGeminiRunForQuestion({
    itemID: params.itemID,
    title: params.sessionTitle,
    sessionId: params.sessionId,
    question: params.question,
    selectedText: params.selectedText,
    annotationIDs: params.annotationIDs,
    resumeSessionId: params.resumeSessionId,
  });

  if (!result.ok) {
    if (!params.suppressChatMessages) {
      addMessage(
        params.chatMessages,
        `Gemini CLI error: ${result.error}`,
        "ai",
      );
    }
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      mode: "gemini_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText: result.error,
      success: false,
    });
    params.streamingIndicator.style.display = "none";
    params.onComplete?.({
      success: false,
      assistantText: result.error,
    });
    return;
  }

  const assistantMessage = params.suppressChatMessages
    ? undefined
    : addMessage(params.chatMessages, "Starting Gemini CLI run…", "ai");

  const poller = setInterval(async () => {
    const progress = await readGeminiRunProgress({
      outputPath: result.outputPath,
      exitCodePath: result.exitCodePath,
    });

    if (assistantMessage) {
      setMessageContent(
        assistantMessage,
        sanitizeAssistantText(progress.parsedOutput || "Running Gemini CLI…"),
        "ai",
      );
    }

    if (!progress.completed) {
      return;
    }

    clearInterval(poller);

    const assistantText = sanitizeAssistantText(
      progress.parsedOutput ||
        "Gemini CLI ran successfully, but returned no assistant message.",
    );

    if (assistantMessage) {
      setMessageContent(assistantMessage, assistantText, "ai");
    }

    const success = progress.exitCode === "0";
    await sessionHistoryService.persistAssistantTurn({
      itemID: params.itemID,
      mode: "gemini_cli",
      paperTitle: params.paperTitle || params.sessionTitle,
      assistantText,
      success,
      rawEvent: progress.rawOutput,
      resumeSessionId: params.resumeSessionId,
    });
    params.streamingIndicator.style.display = "none";
    params.onComplete?.({
      success,
      assistantText,
    });
  }, 800);
}
