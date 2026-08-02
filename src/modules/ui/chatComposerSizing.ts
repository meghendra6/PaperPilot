export const CHAT_INPUT_MIN_HEIGHT = 72;
export const CHAT_INPUT_MAX_HEIGHT = 180;

export function getChatComposerHeight(
  scrollHeight: number,
  minHeight = CHAT_INPUT_MIN_HEIGHT,
  maxHeight = CHAT_INPUT_MAX_HEIGHT,
) {
  return Math.max(minHeight, Math.min(scrollHeight, maxHeight));
}

export function installChatComposerAutosize(input: HTMLTextAreaElement) {
  const resize = () => {
    input.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
    input.style.height = `${getChatComposerHeight(input.scrollHeight)}px`;
    input.scrollTop = 0;
  };

  input.addEventListener("input", resize);
  resize();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    input.removeEventListener("input", resize);
  };
}
