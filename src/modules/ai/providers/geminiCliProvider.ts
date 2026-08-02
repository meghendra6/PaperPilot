import type { ReaderAiProvider } from "../provider";

export class GeminiCliProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "gemini_cli" as const,
      label: "Gemini CLI",
      status: "idle" as const,
      placeholderResponse:
        "Gemini CLI mode is selected. Ask a question to check the local CLI and start a paper-grounded conversation.",
    };
  }
}
