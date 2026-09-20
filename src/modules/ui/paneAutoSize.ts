export const MIN_READER_PANE_HEIGHT = 420;

/** Reserve the space below the actual section, including Zotero's other sections. */
export function getAutomaticPaneHeight(
  viewportHeight: number,
  paneTop: number,
) {
  const available = viewportHeight - Math.max(0, paneTop) - 12;
  return Math.round(
    Math.max(MIN_READER_PANE_HEIGHT, Math.min(1400, available)),
  );
}

export function installAutomaticPaneHeight(params: {
  target: HTMLElement;
  hasManualHeight(): boolean;
}) {
  const win = params.target.ownerDocument.defaultView;
  let frame: number | undefined;
  let disposed = false;
  const update = () => {
    frame = undefined;
    if (disposed || params.hasManualHeight() || !win) return;
    const bounds = params.target.getBoundingClientRect();
    if (!bounds.width) return;
    const height = `${getAutomaticPaneHeight(win.innerHeight, bounds.top)}px`;
    if (
      params.target.style.getPropertyValue("--pp-auto-pane-height") !== height
    )
      params.target.style.setProperty("--pp-auto-pane-height", height);
  };
  const refresh = () => {
    if (!disposed && frame === undefined)
      frame = win?.requestAnimationFrame(update);
  };
  const observer = win?.ResizeObserver
    ? new win.ResizeObserver(refresh)
    : undefined;
  // Sibling sections can move this pane without changing its own dimensions.
  // Do not listen to scrolling: scrolling the sidebar must not resize its content.
  for (
    let node: Element | null = params.target;
    node;
    node = node.parentElement
  ) {
    observer?.observe(node);
    for (
      let previous = node.previousElementSibling;
      previous;
      previous = previous.previousElementSibling
    )
      observer?.observe(previous);
  }
  win?.addEventListener("resize", refresh);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      if (frame !== undefined) win?.cancelAnimationFrame(frame);
      observer?.disconnect();
      win?.removeEventListener("resize", refresh);
    },
  };
}
