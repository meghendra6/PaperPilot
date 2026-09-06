interface TextEndpoint {
  key: string;
  offset: number;
}
export interface ChatTextSelection {
  anchor: TextEndpoint;
  focus: TextEndpoint;
}
export interface NativeSelectionPosition {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
}
export function getNativeSelectionPosition(
  doc: Document,
): NativeSelectionPosition | undefined {
  const selection = doc.getSelection?.();
  return selection
    ? {
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
      }
    : undefined;
}
export function captureChatTextSelection(
  container: HTMLElement,
): ChatTextSelection | undefined {
  const selection = container.ownerDocument.getSelection?.();
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode
  )
    return undefined;
  const endpoint = (node: Node, offset: number): TextEndpoint | undefined => {
    const element =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    const wrapper = element?.closest<HTMLElement>(".pp-message-wrapper");
    if (!wrapper?.dataset.ppTranscriptKey || !container.contains(wrapper))
      return undefined;
    const range = container.ownerDocument.createRange();
    range.selectNodeContents(wrapper);
    range.setEnd(node, offset);
    return {
      key: wrapper.dataset.ppTranscriptKey,
      offset: range.toString().length,
    };
  };
  try {
    const anchor = endpoint(selection.anchorNode, selection.anchorOffset);
    const focus = endpoint(selection.focusNode, selection.focusOffset);
    return anchor && focus ? { anchor, focus } : undefined;
  } catch {
    return undefined;
  }
}
/** Restore synchronously after rebuilding; never replace a newer native selection. */
export function restoreChatTextSelection(
  container: HTMLElement,
  saved: ChatTextSelection | undefined,
  expected: NativeSelectionPosition | undefined,
): boolean {
  const selection = container.ownerDocument.getSelection?.();
  if (
    !saved ||
    !selection ||
    !expected ||
    selection.anchorNode !== expected.anchorNode ||
    selection.anchorOffset !== expected.anchorOffset ||
    selection.focusNode !== expected.focusNode ||
    selection.focusOffset !== expected.focusOffset
  )
    return false;
  const wrappers = Array.from(
    container.querySelectorAll(".pp-message-wrapper"),
  ) as HTMLElement[];
  const point = (
    endpoint: TextEndpoint,
  ): { node: Node; offset: number } | undefined => {
    const wrapper = wrappers.find(
      (node) => node.dataset.ppTranscriptKey === endpoint.key,
    );
    if (!wrapper) return undefined;
    const walker = container.ownerDocument.createTreeWalker(wrapper, 4);
    let remaining = endpoint.offset;
    while (walker.nextNode()) {
      const length = walker.currentNode.nodeValue?.length ?? 0;
      if (remaining <= length)
        return { node: walker.currentNode, offset: remaining };
      remaining -= length;
    }
    return remaining === 0 ? { node: wrapper, offset: 0 } : undefined;
  };
  const anchor = point(saved.anchor);
  const focus = point(saved.focus);
  if (!anchor || !focus) return false;
  if (typeof selection.setBaseAndExtent === "function")
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset,
    );
  else if (typeof selection.extend === "function") {
    selection.collapse(anchor.node, anchor.offset);
    selection.extend(focus.node, focus.offset);
  } else return false;
  return true;
}

/** During one synchronous rebuild retain both ends of a selected message span. */
export function includeChatSelectionRange(
  range: { start: number; end: number },
  keys: readonly string[],
  selection: ChatTextSelection | undefined,
) {
  if (!selection) return range;
  const anchor = keys.indexOf(selection.anchor.key);
  const focus = keys.indexOf(selection.focus.key);
  if (anchor < 0 || focus < 0) return range;
  const first = Math.min(anchor, focus);
  const last = Math.max(anchor, focus);
  const size = Math.max(range.end - range.start, last - first + 1);
  const start = Math.max(
    0,
    Math.min(first, Math.max(range.start, last - size + 1), keys.length - size),
  );
  return { start, end: Math.min(keys.length, start + size) };
}
