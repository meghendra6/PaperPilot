import type { ReaderAiProvider } from "../provider";

export class ClaudeCodeProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "claude_code" as const,
      label: "Claude Code",
      status: "idle" as const,
      placeholderResponse:
        "Ask about this paper below. Open the Claude header to change the engine or model.",
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
