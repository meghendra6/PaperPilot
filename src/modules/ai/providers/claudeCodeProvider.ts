import type { ReaderAiProvider } from "../provider";

export class ClaudeCodeProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "claude_code" as const,
      label: "Claude Code",
      status: "idle" as const,
      placeholderResponse:
        "Claude Code mode is selected. Ask a question to check the local CLI and start a paper-grounded conversation.",
    };
  }
}
