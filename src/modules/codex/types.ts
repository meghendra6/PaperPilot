export interface CodexExecOptions {
  cd: string;
  model: string;
  reasoningEffort?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalMode?: string;
  webSearchEnabled?: boolean;
  skipGitRepoCheck?: boolean;
  imagePath?: string;
}

export interface CodexResumeOptions {
  cd: string;
  sessionId?: string;
  model?: string;
  reasoningEffort?: string;
  webSearchEnabled?: boolean;
}
