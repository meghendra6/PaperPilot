import { addMessage, setMessageContent } from "../components/ChatMessage";
import { messageStore } from "../message/messageStore";
import { sanitizeAssistantText } from "../message/assistantOutput";
import { sessionStore } from "../session/sessionStore";
import { startGeminiRunForQuestion, readGeminiRunProgress } from "./runner";

export async function handleGeminiQuestion(params: {
  itemID: number;
  sessionId: string;
  sessionTitle: string;
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
      messageStore.append(params.sessionId, {
        role: "assistant",
        text: result.error,
        sourceMode: "gemini_cli",
        status: "error",
      });
    }
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
    if (!params.suppressChatMessages) {
      messageStore.append(params.sessionId, {
        role: "assistant",
        text: assistantText,
        sourceMode: "gemini_cli",
        status: success ? "done" : "error",
        rawEvent: progress.rawOutput,
      });
    }

    sessionStore.update(
      params.itemID,
      "gemini_cli",
      params.sessionTitle,
      (existing) => {
        existing.lastGeminiSessionID = success
          ? params.resumeSessionId || "latest"
          : existing.lastGeminiSessionID;
      },
    );
    params.streamingIndicator.style.display = "none";
    params.onComplete?.({
      success,
      assistantText,
    });
  }, 800);
}
