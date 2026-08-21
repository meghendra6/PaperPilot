export const PANE_RESIZE_STEP = 24;

export function clampPaneAreaHeight(
  height: number,
  minHeight: number,
  maxHeight: number,
): number {
  const normalizedMax = Math.max(minHeight, maxHeight);
  return Math.round(Math.max(minHeight, Math.min(height, normalizedMax)));
}

export function getKeyboardResizeHeight(params: {
  currentHeight: number;
  key: string;
  minHeight: number;
  maxHeight: number;
  step?: number;
}): number | undefined {
  const step = params.step ?? PANE_RESIZE_STEP;
  if (params.key === "ArrowUp") {
    return clampPaneAreaHeight(
      params.currentHeight - step,
      params.minHeight,
      params.maxHeight,
    );
  }
  if (params.key === "ArrowDown") {
    return clampPaneAreaHeight(
      params.currentHeight + step,
      params.minHeight,
      params.maxHeight,
    );
  }
  if (params.key === "Home") return params.minHeight;
  if (params.key === "End") {
    return Math.max(params.minHeight, params.maxHeight);
  }
  return undefined;
}

export interface VerticalResizeHandle {
  root: HTMLElement;
  reset(): void;
  dispose(): void;
}

export function createVerticalResizeHandle(params: {
  doc: Document;
  target: HTMLElement;
  label: string;
  minHeight: number;
  getMaxHeight(): number;
  initialHeight?: number;
  onHeightChange?(height: number | undefined): void;
}): VerticalResizeHandle {
  const handle = params.doc.createElement("div");
  handle.className = "pp-resize-handle";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", params.label);
  handle.title =
    "Drag to resize. Use arrow keys for precise control. Double-click to reset.";

  let activePointerID: number | undefined;
  let dragStartY = 0;
  let dragStartHeight = 0;
  let disposed = false;
  let accessibilityRefreshFrame: number | undefined;

  const getCurrentHeight = () =>
    params.target.getBoundingClientRect().height || params.minHeight;
  const getMaxHeight = () => Math.max(params.minHeight, params.getMaxHeight());
  const updateAccessibilityValue = (height = getCurrentHeight()) => {
    const maxHeight = getMaxHeight();
    handle.setAttribute("aria-valuemin", String(params.minHeight));
    handle.setAttribute("aria-valuemax", String(Math.round(maxHeight)));
    handle.setAttribute(
      "aria-valuenow",
      String(clampPaneAreaHeight(height, params.minHeight, maxHeight)),
    );
  };
  const applyHeight = (height: number, notify = true) => {
    const nextHeight = clampPaneAreaHeight(
      height,
      params.minHeight,
      getMaxHeight(),
    );
    params.target.style.height = `${nextHeight}px`;
    params.target.style.flexBasis = `${nextHeight}px`;
    params.target.style.flexGrow = "0";
    params.target.style.flexShrink = "0";
    updateAccessibilityValue(nextHeight);
    if (notify) params.onHeightChange?.(nextHeight);
  };
  const reset = () => {
    params.target.style.removeProperty("height");
    params.target.style.removeProperty("flex-basis");
    params.target.style.removeProperty("flex-grow");
    params.target.style.removeProperty("flex-shrink");
    updateAccessibilityValue();
    params.onHeightChange?.(undefined);
  };

  const endPointerResize = (event: PointerEvent) => {
    if (activePointerID !== event.pointerId) return;
    if (handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    activePointerID = undefined;
    handle.classList.remove("pp-resize-handle--active");
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerID = event.pointerId;
    dragStartY = event.clientY;
    dragStartHeight = getCurrentHeight();
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add("pp-resize-handle--active");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (activePointerID !== event.pointerId) return;
    event.preventDefault();
    applyHeight(dragStartHeight + event.clientY - dragStartY);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      reset();
      return;
    }
    const nextHeight = getKeyboardResizeHeight({
      currentHeight: getCurrentHeight(),
      key: event.key,
      minHeight: params.minHeight,
      maxHeight: getMaxHeight(),
      step: event.shiftKey ? PANE_RESIZE_STEP * 2 : PANE_RESIZE_STEP,
    });
    if (nextHeight === undefined) return;
    event.preventDefault();
    applyHeight(nextHeight);
  };
  const onDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    reset();
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", endPointerResize);
  handle.addEventListener("pointercancel", endPointerResize);
  handle.addEventListener("keydown", onKeyDown);
  handle.addEventListener("dblclick", onDoubleClick);
  if (params.initialHeight !== undefined) {
    applyHeight(params.initialHeight, false);
  } else {
    updateAccessibilityValue();
  }
  accessibilityRefreshFrame = params.doc.defaultView?.requestAnimationFrame(
    () => {
      accessibilityRefreshFrame = undefined;
      if (!disposed) updateAccessibilityValue();
    },
  );

  return {
    root: handle,
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (accessibilityRefreshFrame !== undefined) {
        params.doc.defaultView?.cancelAnimationFrame(accessibilityRefreshFrame);
        accessibilityRefreshFrame = undefined;
      }
      if (
        activePointerID !== undefined &&
        handle.hasPointerCapture?.(activePointerID)
      ) {
        handle.releasePointerCapture(activePointerID);
      }
      activePointerID = undefined;
      handle.classList.remove("pp-resize-handle--active");
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", endPointerResize);
      handle.removeEventListener("pointercancel", endPointerResize);
      handle.removeEventListener("keydown", onKeyDown);
      handle.removeEventListener("dblclick", onDoubleClick);
    },
  };
}
