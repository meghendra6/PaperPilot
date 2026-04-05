import type { CodexExecOptions, CodexResumeOptions } from "./types";

const LEGACY_APPROVAL_MODE_MAP: Record<string, string> = {
  suggested: "never",
  "auto-edit": "never",
  autoedit: "never",
  manual: "untrusted",
};

const SUPPORTED_APPROVAL_MODES = new Set([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

function maybePush(parts: string[], enabled: boolean, value: string) {
  if (enabled) {
    parts.push(value);
  }
}

export function normalizeCodexApprovalMode(approvalMode?: string) {
  const normalized = String(approvalMode || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (SUPPORTED_APPROVAL_MODES.has(normalized)) {
    return normalized;
  }

  return LEGACY_APPROVAL_MODE_MAP[normalized];
}

export function buildCodexLoginStatusCommand(executablePath = "codex") {
  return [executablePath, "login", "status"];
}

export function buildCodexExecCommand(
  options: CodexExecOptions,
  executablePath = "codex",
) {
  const parts = [executablePath];
  const approvalMode = normalizeCodexApprovalMode(options.approvalMode);

  if (approvalMode) {
    parts.push("--ask-for-approval", approvalMode);
  }

  maybePush(parts, Boolean(options.webSearchEnabled), "--search");

  parts.push(
    "exec",
    "--json",
    "--cd",
    options.cd,
    "--model",
    options.model,
    "--sandbox",
    options.sandbox ?? "read-only",
  );

  if (options.reasoningEffort) {
    parts.push("-c", `model_reasoning_effort="${options.reasoningEffort}"`);
  }

  if (options.imagePath) {
    parts.push("--image", options.imagePath);
  }

  maybePush(parts, Boolean(options.skipGitRepoCheck), "--skip-git-repo-check");
  parts.push("-");
  return parts;
}

export function buildCodexResumeCommand(
  options: CodexResumeOptions,
  executablePath = "codex",
) {
  const parts = [executablePath];

  maybePush(parts, Boolean(options.webSearchEnabled), "--search");

  parts.push("exec", "--json", "--cd", options.cd, "--skip-git-repo-check");

  if (options.model) {
    parts.push("--model", options.model);
  }

  if (options.reasoningEffort) {
    parts.push("-c", `model_reasoning_effort="${options.reasoningEffort}"`);
  }

  parts.push(
    "resume",
    ...(options.sessionId ? [options.sessionId] : ["--last"]),
    "-",
  );

  return parts;
}
