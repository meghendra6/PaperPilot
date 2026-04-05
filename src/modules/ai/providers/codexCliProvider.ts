import type { ReaderAiProvider } from "../provider";

export class CodexCliProvider implements ReaderAiProvider {
  getDescriptor() {
    return {
      mode: "codex_cli" as const,
      label: "Codex CLI",
      status: "ready" as const,
      placeholderResponse:
        "Codex CLI mode is ready. Use the reader controls to authenticate, choose a model, and continue the paper conversation.",
    };
  }
}
