import type { ReaderAiProvider } from "../provider";

export class ClaudeCodeProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "claude_code" as const,
      label: "Claude Code",
      status: "ready" as const,
      placeholderResponse:
        "Claude Code mode is ready. Ask questions about the current paper and continue the conversation in this pane.",
    };
  }
}
