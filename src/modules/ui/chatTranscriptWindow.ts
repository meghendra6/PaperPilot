export const CHAT_TRANSCRIPT_WINDOW_SIZE = 48;
export const CHAT_TRANSCRIPT_WINDOW_STEP = 16;

export interface ChatTranscriptWindowRange {
  start: number;
  end: number;
}

export function getLatestChatTranscriptWindow(
  total: number,
  windowSize = CHAT_TRANSCRIPT_WINDOW_SIZE,
): ChatTranscriptWindowRange {
  const normalizedTotal = Math.max(0, Math.floor(total));
  const normalizedSize = Math.max(1, Math.floor(windowSize));
  return {
    start: Math.max(0, normalizedTotal - normalizedSize),
    end: normalizedTotal,
  };
}

export function shiftChatTranscriptWindow(params: {
  range: ChatTranscriptWindowRange;
  total: number;
  direction: "earlier" | "newer";
  windowSize?: number;
  step?: number;
}): ChatTranscriptWindowRange {
  const latest = getLatestChatTranscriptWindow(params.total, params.windowSize);
  const windowSize = latest.end - latest.start || 1;
  const step = Math.max(
    1,
    Math.floor(params.step ?? CHAT_TRANSCRIPT_WINDOW_STEP),
  );
  const start = Math.max(0, Math.min(params.range.start, latest.end));
  const end = Math.max(start, Math.min(params.range.end, latest.end));

  if (params.direction === "earlier") {
    const nextStart = Math.max(0, start - step);
    return {
      start: nextStart,
      end: Math.min(latest.end, nextStart + windowSize),
    };
  }

  const nextEnd = Math.min(latest.end, end + step);
  return {
    start: Math.max(0, nextEnd - windowSize),
    end: nextEnd,
  };
}

export interface ChatTranscriptWindowHandle {
  showLatest(): void;
  dispose(): void;
}

interface RegisteredChatTranscriptWindow {
  prepareAppend(): void;
  notifyAppend(wrapper: HTMLElement): void;
  dispose(): void;
}

const transcriptWindows = new WeakMap<
  Element,
  RegisteredChatTranscriptWindow
>();

function getMessageWrappers(container: Element): HTMLElement[] {
  return Array.from(
    container.querySelectorAll(".pp-message-wrapper"),
  ) as unknown as HTMLElement[];
}

export function prepareChatTranscriptAppend(container: Element): void {
  transcriptWindows.get(container)?.prepareAppend();
}

export function notifyChatTranscriptAppend(
  container: Element,
  wrapper: HTMLElement,
): void {
  transcriptWindows.get(container)?.notifyAppend(wrapper);
}

export function disposeChatTranscriptWindow(container: Element): void {
  transcriptWindows.get(container)?.dispose();
}

export function renderChatTranscriptWindow<T>(params: {
  container: HTMLElement;
  getItems(): readonly T[];
  getKey(item: T, index: number): string;
  renderItem(item: T): HTMLElement | null;
  windowSize?: number;
  step?: number;
}): ChatTranscriptWindowHandle {
  disposeChatTranscriptWindow(params.container);

  const windowSize = Math.max(
    1,
    Math.floor(params.windowSize ?? CHAT_TRANSCRIPT_WINDOW_SIZE),
  );
  const step = Math.max(
    1,
    Math.floor(params.step ?? CHAT_TRANSCRIPT_WINDOW_STEP),
  );
  let range = getLatestChatTranscriptWindow(
    params.getItems().length,
    windowSize,
  );
  let rendering = false;
  let disposed = false;
  let suppressScroll = false;
  let scrollFrame: number | undefined;
  let latestScrollFrame: number | undefined;
  let lastScrollTop = 0;
  let liveKey = 0;
  let suspendedBefore = range.start;
  let atLatest = true;

  const doc = params.container.ownerDocument;
  const view = doc.defaultView;

  const releaseScrollSuppression = () => {
    if (!view?.requestAnimationFrame) {
      suppressScroll = false;
      lastScrollTop = params.container.scrollTop;
      return;
    }
    if (scrollFrame !== undefined) view.cancelAnimationFrame(scrollFrame);
    scrollFrame = view.requestAnimationFrame(() => {
      scrollFrame = undefined;
      suppressScroll = false;
      lastScrollTop = params.container.scrollTop;
    });
  };

  const cancelLatestScroll = () => {
    if (latestScrollFrame === undefined) return;
    view?.cancelAnimationFrame(latestScrollFrame);
    latestScrollFrame = undefined;
  };

  const settleLatestScroll = () => {
    const scrollToBottom = () => {
      params.container.scrollTop = params.container.scrollHeight;
    };
    scrollToBottom();

    if (!view?.requestAnimationFrame) {
      suppressScroll = false;
      lastScrollTop = params.container.scrollTop;
      return;
    }
    if (scrollFrame !== undefined) {
      view.cancelAnimationFrame(scrollFrame);
      scrollFrame = undefined;
    }
    cancelLatestScroll();
    latestScrollFrame = view.requestAnimationFrame(() => {
      scrollToBottom();
      latestScrollFrame = view.requestAnimationFrame(() => {
        latestScrollFrame = undefined;
        scrollToBottom();
        suppressScroll = false;
        lastScrollTop = params.container.scrollTop;
      });
    });
  };

  const captureAnchor = () => {
    const containerTop = params.container.getBoundingClientRect().top;
    const wrapper = getMessageWrappers(params.container).find(
      (candidate) => candidate.getBoundingClientRect().bottom >= containerTop,
    );
    if (!wrapper?.dataset.ppTranscriptKey) return undefined;
    return {
      key: wrapper.dataset.ppTranscriptKey,
      offset: wrapper.getBoundingClientRect().top - containerTop,
    };
  };

  const restoreAnchor = (
    anchor: { key: string; offset: number } | undefined,
  ) => {
    if (!anchor) return false;
    const wrapper = getMessageWrappers(params.container).find(
      (candidate) => candidate.dataset.ppTranscriptKey === anchor.key,
    );
    if (!wrapper) return false;
    const containerTop = params.container.getBoundingClientRect().top;
    params.container.scrollTop +=
      wrapper.getBoundingClientRect().top - containerTop - anchor.offset;
    return true;
  };

  const makeControl = (
    direction: "earlier" | "newer",
    hiddenCount: number,
    onActivate: (fromButton: boolean) => void,
  ) => {
    const root = doc.createElement("div");
    root.className = `pp-chat-window-control pp-chat-window-control--${direction}`;
    root.dataset.ppChatWindowControl = direction;

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pp-btn pp-btn--ghost";
    button.textContent =
      direction === "earlier"
        ? `Show ${Math.min(step, hiddenCount)} earlier messages`
        : `Show ${Math.min(step, hiddenCount)} newer messages`;
    button.addEventListener("click", () => onActivate(true));

    const note = doc.createElement("span");
    note.textContent = ` · ${hiddenCount} message${hiddenCount === 1 ? "" : "s"} suspended`;
    root.append(button, note);
    return root;
  };

  const normalizeRange = (
    candidate: ChatTranscriptWindowRange,
    total: number,
  ) => {
    const latest = getLatestChatTranscriptWindow(total, windowSize);
    const start = Math.max(0, Math.min(candidate.start, latest.end));
    return {
      start,
      end: Math.max(start, Math.min(candidate.end, latest.end)),
    };
  };

  function renderRange(
    nextRange: ChatTranscriptWindowRange,
    behavior: "latest" | "preserve",
    focusDirection?: "earlier" | "newer",
  ): void {
    if (disposed) return;
    cancelLatestScroll();
    const items = params.getItems();
    const normalized = normalizeRange(nextRange, items.length);
    const anchor = behavior === "preserve" ? captureAnchor() : undefined;
    rendering = true;
    suppressScroll = true;
    params.container.replaceChildren();

    if (normalized.start > 0) {
      params.container.append(
        makeControl("earlier", normalized.start, (fromButton) =>
          shift("earlier", fromButton),
        ),
      );
    }

    for (let index = normalized.start; index < normalized.end; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      const wrapper = params.renderItem(item);
      if (wrapper) {
        wrapper.dataset.ppTranscriptKey = params.getKey(item, index);
      }
    }

    const newerCount = items.length - normalized.end;
    if (newerCount > 0) {
      params.container.append(
        makeControl("newer", newerCount, (fromButton) =>
          shift("newer", fromButton),
        ),
      );
    }

    range = normalized;
    suspendedBefore = normalized.start;
    atLatest = normalized.end >= items.length;
    rendering = false;
    if (behavior === "latest") {
      settleLatestScroll();
    } else if (!restoreAnchor(anchor)) {
      params.container.scrollTop =
        focusDirection === "earlier" ? params.container.scrollHeight : 0;
    }
    if (focusDirection) {
      params.container
        .querySelector<HTMLButtonElement>(
          `.pp-chat-window-control--${focusDirection} button`,
        )
        ?.focus({ preventScroll: true });
    }
    if (behavior === "preserve") releaseScrollSuppression();
  }

  const shift = (direction: "earlier" | "newer", fromButton = false) => {
    const total = params.getItems().length;
    const sourceRange = atLatest
      ? getLatestChatTranscriptWindow(total, windowSize)
      : range;
    const nextRange = shiftChatTranscriptWindow({
      range: sourceRange,
      total,
      direction,
      windowSize,
      step,
    });
    if (
      nextRange.start === sourceRange.start &&
      nextRange.end === sourceRange.end
    ) {
      return;
    }
    renderRange(nextRange, "preserve", fromButton ? direction : undefined);
  };

  const updateEarlierControl = () => {
    const existing = params.container.querySelector<HTMLElement>(
      '[data-pp-chat-window-control="earlier"]',
    );
    if (suspendedBefore <= 0) {
      existing?.remove();
      return;
    }
    const replacement = makeControl("earlier", suspendedBefore, () => {
      const total = params.getItems().length;
      const latest = getLatestChatTranscriptWindow(total, windowSize);
      if (suspendedBefore > latest.start) {
        renderRange(latest, "latest");
      } else {
        range = latest;
        atLatest = true;
      }
      if (latest.start > 0) shift("earlier", true);
    });
    if (existing) existing.replaceWith(replacement);
    else params.container.prepend(replacement);
  };

  const showLatest = () => {
    renderRange(
      getLatestChatTranscriptWindow(params.getItems().length, windowSize),
      "latest",
    );
  };

  const onScroll = () => {
    if (disposed || rendering || suppressScroll || scrollFrame !== undefined) {
      return;
    }
    if (!view?.requestAnimationFrame) return;
    scrollFrame = view.requestAnimationFrame(() => {
      scrollFrame = undefined;
      if (disposed || rendering || suppressScroll) return;
      const currentScrollTop = params.container.scrollTop;
      const movingUp = currentScrollTop < lastScrollTop;
      const movingDown = currentScrollTop > lastScrollTop;
      lastScrollTop = currentScrollTop;
      if (params.container.scrollHeight <= params.container.clientHeight + 1) {
        return;
      }
      if (movingUp && currentScrollTop <= 24 && range.start > 0) {
        shift("earlier");
        return;
      }
      const atBottom =
        currentScrollTop + params.container.clientHeight >=
        params.container.scrollHeight - 24;
      if (movingDown && atBottom && range.end < params.getItems().length) {
        shift("newer");
      }
    });
  };

  params.container.addEventListener("scroll", onScroll, { passive: true });

  const registered: RegisteredChatTranscriptWindow = {
    prepareAppend() {
      if (disposed || rendering) return;
      if (!atLatest) showLatest();
    },
    notifyAppend(wrapper) {
      if (disposed || rendering) return;
      wrapper.dataset.ppTranscriptKey ||= `live-${liveKey++}`;
      const wrappers = getMessageWrappers(params.container);
      const overflow = Math.max(0, wrappers.length - windowSize);
      for (const oldWrapper of wrappers.slice(0, overflow)) {
        oldWrapper.remove();
      }
      suspendedBefore = Math.max(
        suspendedBefore + overflow,
        getLatestChatTranscriptWindow(params.getItems().length, windowSize)
          .start,
      );
      range = getLatestChatTranscriptWindow(
        params.getItems().length,
        windowSize,
      );
      atLatest = true;
      updateEarlierControl();
      params.container.scrollTop = params.container.scrollHeight;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      params.container.removeEventListener("scroll", onScroll);
      if (scrollFrame !== undefined) view?.cancelAnimationFrame(scrollFrame);
      cancelLatestScroll();
      scrollFrame = undefined;
      if (transcriptWindows.get(params.container) === registered) {
        transcriptWindows.delete(params.container);
      }
    },
  };

  transcriptWindows.set(params.container, registered);
  showLatest();

  return {
    showLatest,
    dispose: () => registered.dispose(),
  };
}
