import type { EngineMode } from "./types";

export type RunFailureKind =
  | "login_required"
  | "executable_missing"
  | "timeout"
  | "workspace_error"
  | "unknown";

export interface RunFailure {
  kind: RunFailureKind;
  engine: EngineMode;
  userMessage: string;
  action?: "open_settings" | "show_login_help";
  rawError: string;
}

export type RunFailureSource =
  | "workspace"
  | "spawn"
  | "process_exit"
  | "timeout";

const LOGIN_PATTERNS: Record<EngineMode, RegExp[]> = {
  codex_cli: [
    /not logged in/i,
    /login required/i,
    /run [`']?codex login/i,
    /authentication required/i,
    /authenticate.*codex/i,
  ],
  claude_code: [
    /not logged in/i,
    /login required/i,
    /authentication required/i,
    /please run \/login/i,
    /oauth.*(?:expired|invalid)/i,
  ],
  gemini_cli: [
    /not (?:logged in|authenticated)/i,
    /login required/i,
    /authentication required/i,
    /gemini_api_key/i,
    /api key.*(?:missing|required|invalid)/i,
  ],
};

const EXECUTABLE_PATTERNS = [
  /\benoent\b/i,
  /command not found/i,
  /no such file or directory/i,
  /executable.*(?:not found|missing|invalid)/i,
  /could not resolve.*executable/i,
  /permission denied.*(?:codex|claude|gemini)/i,
];

export function getEngineLabel(engine: EngineMode): string {
  if (engine === "claude_code") return "Claude Code";
  if (engine === "gemini_cli") return "Gemini CLI";
  return "Codex CLI";
}

export function classifyRunFailure(params: {
  engine: EngineMode;
  rawError: string;
  source: RunFailureSource;
}): RunFailure {
  const rawError = String(params.rawError || "").trim();
  const label = getEngineLabel(params.engine);

  if (params.source === "workspace") {
    return {
      kind: "workspace_error",
      engine: params.engine,
      userMessage:
        "Paper Pilot could not prepare a writable workspace for this paper. Check workspace settings and permissions.",
      action: "open_settings",
      rawError,
    };
  }

  if (params.source === "timeout") {
    return {
      kind: "timeout",
      engine: params.engine,
      userMessage: `${label} stopped after the 30-minute run limit. Retry when the local CLI is responsive.`,
      rawError,
    };
  }

  if (EXECUTABLE_PATTERNS.some((pattern) => pattern.test(rawError))) {
    return {
      kind: "executable_missing",
      engine: params.engine,
      userMessage: `${label} executable could not be found. Check its path in Paper Pilot settings.`,
      action: "open_settings",
      rawError,
    };
  }

  if (LOGIN_PATTERNS[params.engine].some((pattern) => pattern.test(rawError))) {
    return {
      kind: "login_required",
      engine: params.engine,
      userMessage: `${label} needs authentication. Sign in with the local CLI, then retry.`,
      action: "show_login_help",
      rawError,
    };
  }

  return {
    kind: "unknown",
    engine: params.engine,
    userMessage: `${label} could not complete this request. Expand Raw logs for diagnostic details.`,
    rawError,
  };
}
