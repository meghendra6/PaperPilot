import type { ReaderAiProvider } from "../provider";

export class GeminiCliProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "gemini_cli" as const,
      label: "Gemini CLI",
      status: "idle" as const,
      placeholderResponse:
        "Ask about this paper below. Open the Gemini header to change the engine or model.",
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
