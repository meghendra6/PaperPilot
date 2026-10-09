export const CHAT_INPUT_MIN_HEIGHT = 72;
export const CHAT_INPUT_MAX_HEIGHT = 180;

export function getChatComposerHeight(
  scrollHeight: number,
  minHeight = CHAT_INPUT_MIN_HEIGHT,
  maxHeight = CHAT_INPUT_MAX_HEIGHT,
) {
  return Math.max(minHeight, Math.min(scrollHeight, maxHeight));
}

// Resizing resets the textarea scroll. Keep the caret in view once text
// outgrows the maximum height.
export function getChatComposerScrollTop(params: {
  scrollHeight: number;
  viewportHeight: number;
  previousScrollTop: number;
  caretAtEnd: boolean;
}) {
  const maxScrollTop = Math.max(0, params.scrollHeight - params.viewportHeight);
  if (maxScrollTop === 0) return 0;
  if (params.caretAtEnd) return maxScrollTop;
  return Math.min(Math.max(0, params.previousScrollTop), maxScrollTop);
}

export function installChatComposerAutosize(input: HTMLTextAreaElement) {
  const resize = () => {
    const previousScrollTop = input.scrollTop;
    input.style.height = `${CHAT_INPUT_MIN_HEIGHT}px`;
    const height = getChatComposerHeight(input.scrollHeight);
    input.style.height = `${height}px`;
    input.scrollTop = getChatComposerScrollTop({
      scrollHeight: input.scrollHeight,
      viewportHeight: input.clientHeight || height,
      previousScrollTop,
      caretAtEnd: input.selectionEnd === input.value?.length,
    });
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
