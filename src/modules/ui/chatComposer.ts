export function getChatComposerPresentation(params: {
  busy: boolean;
  stopping: boolean;
  canStop: boolean;
}) {
  return {
    inputDisabled: false,
    buttonDisabled: params.busy && (params.stopping || !params.canStop),
    label: params.stopping ? "Stopping…" : params.busy ? "Stop" : "Send",
    ariaLabel: params.stopping
      ? "Stopping response"
      : params.busy
        ? "Stop response"
        : "Send message",
    placeholder: params.stopping
      ? "Draft your next question while this request stops."
      : params.busy
        ? "Draft your next question. Press Stop to cancel the current response."
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
  const presentation = getChatComposerPresentation(params);
  params.input.disabled = presentation.inputDisabled;
  params.input.placeholder = presentation.placeholder;
  params.button.disabled = presentation.buttonDisabled;
  params.button.textContent = presentation.label;
  params.button.setAttribute("aria-label", presentation.ariaLabel);
  params.button.title = presentation.ariaLabel;
  params.button.dataset.action = params.busy ? "stop" : "send";
}
