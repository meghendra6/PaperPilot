import type { ReaderAiProvider } from "../provider";

export class GeminiCliProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "gemini_cli" as const,
      label: "Gemini CLI",
      status: "ready" as const,
      placeholderResponse:
        "Gemini CLI mode is ready. Ask questions about the current paper and continue the conversation in this pane.",
    };
  }
}
