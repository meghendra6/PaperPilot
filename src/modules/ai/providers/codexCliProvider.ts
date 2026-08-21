import type { ReaderAiProvider } from "../provider";
import { getPref } from "../../../utils/prefs";

export class CodexCliProvider implements ReaderAiProvider {
  getDescriptor() {
    let agentWebSearch = false;
    try {
      agentWebSearch = Boolean(getPref("codexEnableWebSearch"));
    } catch {
      agentWebSearch = false;
    }
    return {
      mode: "codex_cli" as const,
      label: "Codex CLI",
      status: "checking" as const,
      placeholderResponse:
        "Ask about this paper below. Open the Codex header to check authentication or change the model.",
      discoveryCapabilities: {
        agentWebSearch,
        structuredCandidateSearch: typeof fetch === "function",
        officialEvidenceFetch: typeof fetch === "function",
      },
    };
  }
}
