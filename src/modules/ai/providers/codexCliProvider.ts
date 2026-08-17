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
        "Codex CLI mode is selected. Use the reader controls to check authentication, choose a model, and continue the paper conversation.",
      discoveryCapabilities: {
        agentWebSearch,
        structuredCandidateSearch: typeof fetch === "function",
        officialEvidenceFetch: typeof fetch === "function",
      },
    };
  }
}
