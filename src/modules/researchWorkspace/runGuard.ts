/**
 * Explicit choice before an action disposes a running Research Workspace
 * analysis. Spec §12.3 forbids silent cancellation and silent orphaning.
 */

export interface RunGuardPromptService {
  confirmEx?: (
    parent: unknown,
    title: string,
    text: string,
    flags: number,
    button0: string | null,
    button1: string | null,
    button2: string | null,
    checkLabel: string | null,
    checkState: { value: boolean },
  ) => number;
  BUTTON_POS_0?: number;
  BUTTON_POS_1?: number;
  BUTTON_TITLE_IS_STRING?: number;
  BUTTON_POS_1_DEFAULT?: number;
}

export interface RunGuardRequest {
  /** What the reader asked for, e.g. "Opening all projects". */
  action: string;
  /** True when the window itself is closing. */
  closing?: boolean;
}

export interface RunGuardCopy {
  title: string;
  message: string;
  cancelLabel: string;
  keepLabel: string;
}

export function describeRunGuard(request: RunGuardRequest): RunGuardCopy {
  return request.closing
    ? {
        title: "Cancel the running analysis?",
        message:
          "Closing the Research Workspace cancels the analysis that is running. Results that were already saved stay in the project.",
        cancelLabel: "Cancel run and close",
        keepLabel: "Keep window open",
      }
    : {
        title: "Cancel the running analysis?",
        message: `${request.action} cancels the analysis that is running in this window. Results that were already saved stay in the project.`,
        cancelLabel: "Cancel run and continue",
        keepLabel: "Keep running",
      };
}

function defaultPromptService(): RunGuardPromptService | undefined {
  return (globalThis as { Services?: { prompt?: RunGuardPromptService } })
    .Services?.prompt;
}

/**
 * Returns true only when the reader explicitly chose to cancel the run.
 * Dismissing the dialog keeps the run, because confirmEx reports a window
 * close as the second button.
 */
export function confirmCancelRunningAnalysis(
  request: RunGuardRequest,
  options: {
    win?: { confirm?: (message: string) => boolean } | null;
    prompt?: RunGuardPromptService;
  } = {},
): boolean {
  const copy = describeRunGuard(request);
  const prompt = options.prompt ?? defaultPromptService();
  if (typeof prompt?.confirmEx === "function") {
    try {
      const titleIsString = prompt.BUTTON_TITLE_IS_STRING ?? 127;
      const flags =
        (prompt.BUTTON_POS_0 ?? 1) * titleIsString +
        (prompt.BUTTON_POS_1 ?? 256) * titleIsString +
        (prompt.BUTTON_POS_1_DEFAULT ?? 0x01000000);
      const choice = prompt.confirmEx(
        options.win ?? null,
        copy.title,
        copy.message,
        flags,
        copy.cancelLabel,
        copy.keepLabel,
        null,
        null,
        { value: false },
      );
      return choice === 0;
    } catch {
      // Fall through to the window confirm below.
    }
  }
  if (typeof options.win?.confirm === "function") {
    return options.win.confirm(
      `${copy.title}\n\n${copy.message}\n\nOK: ${copy.cancelLabel}\nCancel: ${copy.keepLabel}`,
    );
  }
  return false;
}
