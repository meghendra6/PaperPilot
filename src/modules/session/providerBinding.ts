import type { EngineMode } from "../ai/types";
import type { PaperSession } from "./types";

/** Legacy provider hints alone cannot authorize continuing a native conversation. */
export function getVerifiedProviderResume(
  session: PaperSession,
  mode: EngineMode,
  sourceID: string,
  sourceFingerprint: string,
): string | undefined {
  const binding = session.providerBindings?.[mode];
  const storedID =
    mode === "codex_cli"
      ? session.lastCodexSessionID
      : mode === "claude_code"
        ? session.lastClaudeSessionID
        : session.lastGeminiSessionID;
  return binding?.status === "verified" &&
    binding.engine === mode &&
    binding.paperpilotSessionId === session.sessionId &&
    binding.sourceID === sourceID &&
    binding.sourceFingerprint === sourceFingerprint &&
    binding.sessionId === storedID &&
    storedID &&
    !["last", "latest"].includes(storedID) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{3,255}$/.test(storedID)
    ? storedID
    : undefined;
}
