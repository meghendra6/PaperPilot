import type { ReaderAiProvider } from "../provider";

export class GeminiCliProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "gemini_cli" as const,
      label: "Gemini CLI",
      status: "idle" as const,
      placeholderResponse:
        "Gemini CLI mode is selected. Ask a question to check the local CLI and start a paper-grounded conversation.",
      discoveryCapabilities: {
        // Gemini's local tool policy is not observable through the current
        // adapter. Fail closed until a runtime capability handshake exists.
        agentWebSearch: false,
        structuredCandidateSearch: typeof fetch === "function",
        officialEvidenceFetch: typeof fetch === "function",
      },
    };
  }
}
