import type { ReaderAiProvider } from "../provider";

export class ClaudeCodeProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "claude_code" as const,
      label: "Claude Code",
      status: "idle" as const,
      placeholderResponse:
        "Claude Code mode is selected. Ask a question to check the local CLI and start a paper-grounded conversation.",
      discoveryCapabilities: {
        // Claude's local tool policy is not observable through the current
        // adapter. Fail closed until a runtime capability handshake exists.
        agentWebSearch: false,
        structuredCandidateSearch: typeof fetch === "function",
        officialEvidenceFetch: typeof fetch === "function",
      },
    };
  }
}
