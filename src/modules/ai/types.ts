export type EngineMode = "gemini_cli" | "codex_cli";

export type ProviderStatus =
  | "ready"
  | "placeholder"
  | "checking"
  | "login_required"
  | "unsupported";

export interface ProviderDescriptor {
  mode: EngineMode;
  label: string;
  status: ProviderStatus;
  placeholderResponse: string;
}
