export type ChatSendAction = "send" | "stop" | "stopping";

export function getChatComposerPresentation(params: {
  busy: boolean;
  stopping: boolean;
  canStop: boolean;
  /** False disables Send, which would otherwise do nothing. */
  hasText?: boolean;
}) {
  const sendAction: ChatSendAction = params.stopping
    ? "stopping"
    : params.busy
      ? "stop"
      : "send";
  return {
    sendAction,
    inputDisabled: false,
    buttonDisabled: params.busy
      ? params.stopping || !params.canStop
      : params.hasText === false,
    label: params.stopping ? "Stopping…" : params.busy ? "Stop" : "Send",
    ariaLabel: params.stopping
      ? "Stopping response"
      : params.busy
        ? params.canStop
          ? "Stop response"
          : "Stop is unavailable while Paper Pilot finishes another task"
        : "Send message",
    // Do not point at Stop while it is disabled.
    placeholder: params.stopping
      ? "Draft your next question while this request stops."
      : params.busy
        ? params.canStop
          ? "Draft your next question. Press Stop to cancel the current response."
          : "Draft your next question. Send returns when Paper Pilot finishes the current task."
        : "Ask a question about this paper or the current selection.",
  };
}

export function renderChatComposer(params: {
  input: HTMLTextAreaElement;
  button: HTMLButtonElement;
  busy: boolean;
  stopping: boolean;
  canStop: boolean;
}) {
  const presentation = getChatComposerPresentation({
    ...params,
    hasText: Boolean(params.input.value?.trim()),
  });
  params.input.disabled = presentation.inputDisabled;
  params.input.placeholder = presentation.placeholder;
  params.button.disabled = presentation.buttonDisabled;
  params.button.textContent = presentation.label;
  params.button.setAttribute("aria-label", presentation.ariaLabel);
  params.button.title = presentation.ariaLabel;
  params.button.dataset.action = params.busy ? "stop" : "send";
  // The stylesheet widens the input's inset for the wider "Stopping…" label.
  params.input.dataset.sendAction = presentation.sendAction;
}

/** A Stop click this soon after Send is the tail of a double-click. */
export const SEND_STOP_GUARD_MS = 500;

/**
 * Send relabels itself to Stop synchronously, so a fast second click would
 * cancel the request it just sent. Ignore that click.
 */
export function shouldIgnoreStopActivation(params: {
  now: number;
  lastSendAt?: number;
  clickDetail?: number;
  guardMs?: number;
}): boolean {
  if ((params.clickDetail ?? 0) > 1) return true;
  if (params.lastSendAt === undefined) return false;
  const elapsed = params.now - params.lastSendAt;
  return elapsed >= 0 && elapsed < (params.guardMs ?? SEND_STOP_GUARD_MS);
}

/** Feedback for Enter while the paper's engine slot is taken. */
export function getBusySubmitHint(params: {
  stopping: boolean;
  canStop: boolean;
}): string {
  if (params.stopping) {
    return "The current answer is stopping. Your draft is kept. Send it when Send returns.";
  }
  if (params.canStop) {
    return "An answer is still running. Your draft is kept. Press Stop to cancel it, or send after it finishes.";
  }
  return "Paper Pilot is finishing another task for this paper. Your draft is kept. Send it when Send returns.";
}
