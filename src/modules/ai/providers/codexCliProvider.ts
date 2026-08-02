import type { ReaderAiProvider } from "../provider";

export class CodexCliProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "codex_cli" as const,
      label: "Codex CLI",
      status: "checking" as const,
      placeholderResponse:
        "Codex CLI mode is selected. Use the reader controls to check authentication, choose a model, and continue the paper conversation.",
    };
  }
}
